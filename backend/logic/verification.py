"""AI credibility filter: deterministic heuristics + optional live LLM analyst.

Two layers, run in order:

  1. Heuristics (always on, offline, deterministic) — metadata checks a text
     model cannot do from prose alone:
       - linguistic: known bot/spam amplification phrasing
       - temporal:   media EXIF capture time far older than the post (recycled footage)
       - spatial:    media EXIF geotag conflicts with the claimed position
  2. Live LLM analyst (opt-in) — tone / specificity / plausibility judgement via
     the OpenAI SDK against the LiteLLM gateway (Qwen3-VL). Enabled only when
     LITELLM_API_KEY is set AND USE_LIVE_AI=true; otherwise ZERO network calls.
     With USE_VISION=true the attached image is judged for plausibility too.

Failure policy (assess_report never raises):
  - LLM answered but returned bad JSON  -> debunked, reason "AI Parsing Error"
  - network / timeout / client failure  -> graceful fallback to the heuristics

The LLM does PER-REPORT extraction + credibility only. Incident-level fields
(centroid, source_ids, confidence, first/last seen) belong to the geospatial
clustering step and are never produced here.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from geopy.distance import geodesic
from openai import BadRequestError, OpenAI, OpenAIError
from pydantic import BaseModel, Field, ValidationError

from schemas import DebunkedReport, RawReport

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger("vost.verification")

# --- Live gateway configuration -------------------------------------------------

LITELLM_BASE_URL: str = "https://litellm-kommone.genai.govdigital.de/v1"
MODEL_ID: str = "stackit-qwen-qwen3-vl-235b-a22b-instruct-fp8"
REQUEST_TIMEOUT_S: float = 20.0  # the demo must never hang on the gateway

SYSTEM_PROMPT: str = (
    "You are an expert OSINT intelligence analyst for VOSTbw, supporting civil-protection "
    "crisis response in Baden-Württemberg. Analyze ONE public social-media report for "
    "situational awareness. "
    "(1) Classify event_type (e.g. flood, fire, storm, accident, power_outage, other). "
    "(2) Assign a credibility_score from 0.0 to 1.0 based on tone, specificity, and plausibility. "
    "(3) Set is_credible=false if the text reads as bot-spam, mass-share bait, or wildly "
    "exaggerated/implausible; true if it reads like a genuine local or first-hand report. "
    "(4) If not credible, give a short reason_flagged (one concise English sentence). "
    "Output ONLY raw JSON, no markdown, no code fences, exactly these keys: "
    '{"is_credible": boolean, "event_type": string, "credibility_score": number, '
    '"reason_flagged": string|null}. Use the metric system. Do not invent coordinates.'
)

VISION_ADDENDUM: str = (
    " The report's attached image is included. Judge whether the imagery is plausibly "
    "consistent with the claimed event type, location and season, and fold that judgement "
    "into credibility_score and, if inconsistent, into reason_flagged."
)

IMAGE_SUFFIXES: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp", ".gif")

# --- Heuristic thresholds (all metric) -------------------------------------------

# Media captured more than this long before being posted is treated as
# recycled footage (the classic flood/fire disinformation pattern).
MAX_EXIF_AGE: timedelta = timedelta(hours=48)

# Media geotagged further than this (km) from the claimed position is treated
# as a location conflict.
MAX_GEOTAG_DRIFT_KM: float = 5.0

# Phrases strongly associated with bot/spam amplification networks.
BOT_SPAM_MARKERS: tuple[str, ...] = (
    "share before they delete",
    "the media won't show you",
    "click here",
    "t.me/breaking",
    "100% confirmed!!!",
    "wake up people",
)

# --- Mode toggles (read at call time so .env changes and tests take effect) ------


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def live_mode_enabled() -> bool:
    """Live LLM calls require BOTH a gateway key and the explicit opt-in toggle."""
    return bool(os.getenv("LITELLM_API_KEY")) and _env_flag("USE_LIVE_AI")


def vision_enabled() -> bool:
    """Image plausibility analysis (stretch goal) — only on top of live mode."""
    return live_mode_enabled() and _env_flag("USE_VISION")


def ai_mode() -> str:
    """For /api/health: 'live' | 'live-ready' (key present, toggle off) | 'mock'."""
    if live_mode_enabled():
        return "live"
    if os.getenv("LITELLM_API_KEY"):
        return "live-ready"
    return "mock"


# --- Result contracts -------------------------------------------------------------


@dataclass(frozen=True)
class Assessment:
    """Outcome of the credibility check for a single report."""

    credible: bool
    reason: str | None
    score: float
    event_type: str | None = None  # LLM-extracted classification (live mode only)


class LLMAnalysis(BaseModel):
    """Strict schema the LLM must produce — validated before anything is trusted."""

    is_credible: bool
    event_type: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    reason_flagged: str | None = None


# --- Gateway client (lazy: never constructed in mock mode) ------------------------

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.getenv("LITELLM_API_KEY"),
            base_url=LITELLM_BASE_URL,
            timeout=REQUEST_TIMEOUT_S,
        )
    return _client


def _is_image_url(url: str | None) -> bool:
    return url is not None and url.lower().split("?")[0].endswith(IMAGE_SUFFIXES)


def _build_messages(report: RawReport, attach_image: bool) -> list[dict[str, Any]]:
    """System prompt + the raw report text with brief context for plausibility."""
    system = SYSTEM_PROMPT + (VISION_ADDENDUM if attach_image else "")
    user_text = (
        f"Source: {report.source}\n"
        f"Author: {report.author}\n"
        f"Claimed position: lat {report.lat}, lon {report.lon}\n"
        f"Posted (UTC): {report.timestamp.isoformat()}\n"
        f"Report text:\n{report.text}"
    )
    user_content: Any = user_text
    if attach_image and report.media_url is not None:
        user_content = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": report.media_url}},
        ]
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]


def _chat_completion(messages: list[dict[str, Any]]) -> str:
    """One gateway round-trip; prefers JSON mode, falls back if unsupported."""
    client = _get_client()
    try:
        response = client.chat.completions.create(
            model=MODEL_ID,
            temperature=0,
            response_format={"type": "json_object"},
            messages=messages,
            timeout=REQUEST_TIMEOUT_S,
        )
    except BadRequestError:
        logger.info("Gateway rejected response_format — retrying without JSON mode")
        response = client.chat.completions.create(
            model=MODEL_ID,
            temperature=0,
            messages=messages,
            timeout=REQUEST_TIMEOUT_S,
        )
    content = response.choices[0].message.content
    if not content:
        raise ValueError("Empty completion from gateway")
    return content


def _strip_code_fences(raw: str) -> str:
    """Tolerate models that wrap JSON in ``` fences despite instructions."""
    text = raw.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        text = text[first_newline + 1 :] if first_newline != -1 else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def analyze_with_llm(report: RawReport) -> Assessment:
    """Live LLM analysis of one report.

    Raises on infra failure (caller falls back to heuristics); returns an
    'AI Parsing Error' debunk Assessment when the model's output is malformed.
    """
    attach_image = vision_enabled() and _is_image_url(report.media_url)
    try:
        raw = _chat_completion(_build_messages(report, attach_image=attach_image))
    except OpenAIError:
        if not attach_image:
            raise
        # Unfetchable media must not sink the report — retry text-only.
        logger.warning("Vision call failed for %s — retrying text-only", report.id)
        raw = _chat_completion(_build_messages(report, attach_image=False))

    try:
        analysis = LLMAnalysis.model_validate_json(_strip_code_fences(raw))
    except ValidationError:
        logger.warning("Unparseable LLM output for %s: %.200s", report.id, raw)
        return Assessment(False, "AI Parsing Error", 0.0)

    event_type = analysis.event_type.strip().lower() or None
    if analysis.is_credible:
        return Assessment(True, None, analysis.credibility_score, event_type)
    return Assessment(
        False,
        analysis.reason_flagged or "Flagged as non-credible by the AI analyst",
        analysis.credibility_score,
        event_type,
    )


# --- Heuristic layer ---------------------------------------------------------------


def _assess_heuristics(report: RawReport) -> Assessment:
    """Deterministic metadata checks; returns the first rule violated, or credible."""
    text = report.text.lower()

    for marker in BOT_SPAM_MARKERS:
        if marker in text:
            return Assessment(False, f'Bot-spam phrasing detected: "{marker}"', 0.05)

    if report.exif_timestamp is not None:
        age = report.timestamp - report.exif_timestamp
        if age > MAX_EXIF_AGE:
            hours = int(age.total_seconds() // 3600)
            return Assessment(
                False,
                f"Recycled footage: media captured {hours} h before it was posted "
                f"(EXIF {report.exif_timestamp:%Y-%m-%d %H:%M} UTC)",
                0.10,
            )

    if report.exif_lat is not None and report.exif_lon is not None:
        drift_km = geodesic(
            (report.lat, report.lon), (report.exif_lat, report.exif_lon)
        ).kilometers
        if drift_km > MAX_GEOTAG_DRIFT_KM:
            return Assessment(
                False,
                f"Geotag conflict: media EXIF places the photo {drift_km:.0f} km "
                f"away from the claimed location",
                0.15,
            )

    return Assessment(True, None, 0.90)


# --- Public contract (unchanged signatures) ------------------------------------------


def assess_report(report: RawReport) -> Assessment:
    """Score a single report. Heuristics always run first; the live LLM analyst
    adds a plausibility judgement when enabled. Never raises."""
    heuristic = _assess_heuristics(report)
    if not heuristic.credible or not live_mode_enabled():
        return heuristic
    try:
        return analyze_with_llm(report)
    except Exception:  # noqa: BLE001 — graceful degradation over hard failure
        logger.exception(
            "LLM analysis failed for %s — falling back to heuristics", report.id
        )
        return heuristic


def apply_event_type(report: RawReport, assessment: Assessment) -> RawReport:
    """Adopt the LLM-extracted event type when it is specific and differs.

    'other' or empty never overrides the ingested classification."""
    extracted = (assessment.event_type or "").strip().lower()
    if extracted and extracted != "other" and extracted != report.event_type:
        return report.model_copy(update={"event_type": extracted})
    return report


def filter_reports(
    reports: list[RawReport],
) -> tuple[list[RawReport], list[DebunkedReport]]:
    """Split raw reports into (credible, debunked)."""
    credible: list[RawReport] = []
    debunked: list[DebunkedReport] = []
    for report in reports:
        assessment = assess_report(report)
        if assessment.credible:
            credible.append(apply_event_type(report, assessment))
        else:
            debunked.append(
                DebunkedReport(
                    id=report.id,
                    source=report.source,
                    author=report.author,
                    text=report.text,
                    event_type=report.event_type,
                    lat=report.lat,
                    lon=report.lon,
                    timestamp=report.timestamp,
                    reason_flagged=assessment.reason or "Failed credibility checks",
                    credibility_score=assessment.score,
                )
            )
    return credible, debunked
