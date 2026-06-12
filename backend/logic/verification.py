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
     With USE_VISION=true the attached image (or a video's preview frame) is
     judged for plausibility too.

GATEWAY VISION CONSTRAINT (verified live): the gateway rejects remote image
URLs (allow-list = stackit.de only). Media must therefore be downloaded by us
and sent as an inline base64 data URI. Download failures degrade to text-only.

Resilience: LITELLM_API_KEYS (comma-separated) are rotated on quota/429
errors; LLM calls are capped by a small semaphore so a burst of new reports
cannot stampede the gateway.

Failure policy (assess_report never raises):
  - LLM answered but returned bad JSON  -> debunked, reason "AI Parsing Error"
  - network / timeout / client failure  -> graceful fallback to the heuristics

The LLM does PER-REPORT extraction + credibility only. Incident-level fields
(centroid, source_ids, confidence, first/last seen) belong to the geospatial
clustering step and are never produced here.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from geopy.distance import geodesic
from openai import BadRequestError, OpenAI, OpenAIError, RateLimitError
from pydantic import BaseModel, Field, ValidationError

from logic.guidance import KNOWN_EVENT_TYPES
from schemas import DebunkedReport, RawReport

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger("vost.verification")

# --- Live gateway configuration -------------------------------------------------

LITELLM_BASE_URL: str = "https://litellm-kommone.genai.govdigital.de/v1"
MODEL_ID: str = "stackit-qwen-qwen3-vl-235b-a22b-instruct-fp8"
REQUEST_TIMEOUT_S: float = 30.0  # vision payloads are larger; still demo-safe

# Media download (for base64 vision) — never let one image stall the pipeline.
MEDIA_TIMEOUT_S: float = 15.0
MAX_MEDIA_BYTES: int = 5_000_000
MIN_MEDIA_BYTES: int = 100  # tiny responses are error pages, not images
MEDIA_USER_AGENT: str = "VOSTbw-OSINT-Dashboard/0.4 (media plausibility check)"

# Cap concurrent gateway calls (the ingestion service analyses in threads).
_LLM_SEMAPHORE = threading.Semaphore(4)

# --- Spend failsafe -------------------------------------------------------------
# Hard cap on gateway calls per process so a runaway poll cannot drain the quota
# the organisers gave us. Persistent dedup (SQLite) already prevents re-analysing
# seen reports across restarts; this guards a single bad run. Set LLM_MAX_CALLS=0
# to disable.
DEFAULT_LLM_MAX_CALLS: int = 500

_budget_lock = threading.Lock()
_llm_calls_made: int = 0
_budget_warned: bool = False


class LLMBudgetExceeded(RuntimeError):
    """Raised when the per-process LLM budget is spent; callers fall back to
    heuristics instead of hitting the gateway."""


SYSTEM_PROMPT: str = (
    "You are an expert OSINT intelligence analyst for VOSTbw, supporting civil-protection "
    "crisis response in Baden-Württemberg. Analyze ONE incoming report for situational awareness. "
    "(1) Classify event_type as exactly one of the official BW crisis-scenario classes: "
    f"{', '.join(KNOWN_EVENT_TYPES)}, or 'other'. "
    "(2) Assign a credibility_score from 0.0 to 1.0 using these explicit rules: "
    "START at 0.5. "
    "RAISE score for: official source (Polizei, Feuerwehr, DWD, NINA, Landratsamt, press office) +0.3; "
    "specific location named +0.1; specific time given +0.05; calm factual tone +0.1; "
    "multiple details consistent with each other +0.1. "
    "LOWER score for: excessive punctuation (!!!!, CAPS LOCK abuse) -0.2; "
    "emoji spam -0.15; vague unverifiable claims ('hunderte eingeschlossen') -0.1; "
    "amplification language ('teilen', 'share before delete', 'media won\\'t show') -0.3; "
    "single unverified social account with no details -0.15. "
    "Clamp final score to [0.0, 1.0]. "
    "(3) Set is_credible=true if score >= 0.45, false otherwise. "
    "(4) If not credible, give a short reason_flagged (one concise English sentence). "
    "(5) Always give a rationale: 1–2 concise English sentences justifying your verdict. "
    "(6) media_consistency: null when no image is attached; otherwise one short sentence on "
    "whether the imagery plausibly matches the claimed event, location and season. "
    "Output ONLY raw JSON, no markdown, no code fences, exactly these keys: "
    '{"is_credible": boolean, "event_type": string, "credibility_score": number, '
    '"reason_flagged": string|null, "rationale": string, "media_consistency": string|null}. '
    "Use the metric system. Do not invent coordinates."
)

VISION_ADDENDUM: str = (
    " The report's attached image is included{frame_note}. Judge whether the imagery is "
    "plausibly consistent with the claimed event type, location and season; put that "
    "judgement into media_consistency and fold it into credibility_score."
)
FRAME_NOTE: str = " (a representative frame of the attached video)"

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
    "#spaß",  # explicit joke/hoax tag on a crisis report
)

# --- Mode toggles (read at call time so .env changes and tests take effect) ------


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _verbose() -> bool:
    """Print the full LLM request + raw response to the console (default ON).

    Set LLM_VERBOSE=false in backend/.env to silence the per-call I/O dump."""
    return os.getenv("LLM_VERBOSE", "true").strip().lower() in {"1", "true", "yes", "on"}


def live_mode_enabled() -> bool:
    """Live LLM calls require BOTH a gateway key and the explicit opt-in toggle."""
    return bool(_key_candidates()[0]) and _env_flag("USE_LIVE_AI")


def vision_enabled() -> bool:
    """Image plausibility analysis — only on top of live mode."""
    return live_mode_enabled() and _env_flag("USE_VISION")


def ai_mode() -> str:
    """For /api/health: 'live' | 'live-ready' (key present, toggle off) | 'mock'."""
    if live_mode_enabled():
        return "live"
    if _key_candidates()[0]:
        return "live-ready"
    return "mock"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip())
    except ValueError:
        return default


def llm_call_budget() -> int:
    """Max gateway calls allowed this process (<= 0 disables the cap)."""
    return _int_env("LLM_MAX_CALLS", DEFAULT_LLM_MAX_CALLS)


def llm_calls_made() -> int:
    return _llm_calls_made


def budget_status() -> dict[str, object]:
    """Spend snapshot for /api/health."""
    cap = llm_call_budget()
    return {
        "llm_calls": _llm_calls_made,
        "llm_budget": cap if cap > 0 else None,
        "llm_calls_remaining": max(0, cap - _llm_calls_made) if cap > 0 else None,
    }


def reset_call_budget() -> None:
    """Zero the per-process call counter (tests / manual ops)."""
    global _llm_calls_made, _budget_warned
    with _budget_lock:
        _llm_calls_made = 0
        _budget_warned = False


def _over_budget() -> bool:
    cap = llm_call_budget()
    return cap > 0 and _llm_calls_made >= cap


def _consume_budget() -> None:
    """Reserve one gateway call; raise LLMBudgetExceeded when the cap is hit."""
    global _llm_calls_made, _budget_warned
    cap = llm_call_budget()
    with _budget_lock:
        if cap > 0 and _llm_calls_made >= cap:
            if not _budget_warned:
                logger.warning(
                    "LLM call budget reached (%d) — pausing live AI, using "
                    "heuristics only. Raise LLM_MAX_CALLS or restart to resume.",
                    cap,
                )
                _budget_warned = True
            raise LLMBudgetExceeded(f"LLM budget of {cap} calls exhausted")
        _llm_calls_made += 1


# --- Result contracts -------------------------------------------------------------


@dataclass(frozen=True)
class Assessment:
    """Outcome of the credibility check for a single report."""

    credible: bool
    reason: str | None
    score: float
    event_type: str | None = None  # LLM-extracted classification (live mode only)
    rationale: str | None = None  # analyst justification (live mode only)
    media_consistency: str | None = None  # media-vs-claim note (vision only)
    analyzed_media: str | None = None  # which image/frame was judged (UI thumbnail)


class LLMAnalysis(BaseModel):
    """Strict schema the LLM must produce — validated before anything is trusted."""

    is_credible: bool
    event_type: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    reason_flagged: str | None = None
    rationale: str = ""
    media_consistency: str | None = None


# --- Gateway clients (lazy; rotated across LITELLM_API_KEYS on quota errors) ------

_clients: dict[str, OpenAI] = {}
_clients_lock = threading.Lock()
_preferred_key_index: int = 0


def _key_candidates() -> list[str]:
    """All configured keys, preferring the multi-key env; always non-empty."""
    multi = [k.strip() for k in os.getenv("LITELLM_API_KEYS", "").split(",") if k.strip()]
    if multi:
        return multi
    single = os.getenv("LITELLM_API_KEY", "").strip()
    return [single] if single else [""]


def _client_for(key: str) -> OpenAI:
    with _clients_lock:
        client = _clients.get(key)
        if client is None:
            client = OpenAI(
                api_key=key, base_url=LITELLM_BASE_URL, timeout=REQUEST_TIMEOUT_S
            )
            _clients[key] = client
        return client


def _is_quota_error(exc: Exception) -> bool:
    return isinstance(exc, RateLimitError) or getattr(exc, "status_code", None) == 429


def _describe_image_url(url: str) -> str:
    """Human-readable stand-in for an image in logs (never dump base64)."""
    if url.startswith("data:"):
        header, _, b64 = url.partition(",")
        mime = header[5:].split(";")[0] or "unknown"
        approx_kb = (len(b64) * 3) // 4 // 1024
        return f"[image data-uri: {mime}, ~{approx_kb} kB base64-redacted]"
    return f"[image url: {url}]"


def _format_request_for_log(messages: list[dict[str, Any]]) -> str:
    """Render the outgoing messages in full (text verbatim, images redacted)."""
    blocks: list[str] = []
    for message in messages:
        role = str(message.get("role", "?")).upper()
        content = message.get("content", "")
        if isinstance(content, str):
            blocks.append(f"[{role}]\n{content}")
            continue
        parts: list[str] = []
        for part in content:
            if part.get("type") == "text":
                parts.append(str(part.get("text", "")))
            elif part.get("type") == "image_url":
                parts.append(_describe_image_url(part.get("image_url", {}).get("url", "")))
            else:
                parts.append(f"[{part.get('type', 'unknown')} part]")
        blocks.append(f"[{role}]\n" + "\n".join(parts))
    return "\n".join(blocks)


def _chat_completion(messages: list[dict[str, Any]]) -> str:
    """One gateway round-trip: JSON mode preferred, key rotation on quota."""
    global _preferred_key_index
    _consume_budget()  # spend failsafe — raises when the per-process cap is hit
    if _verbose():
        print(
            f"\n[LLM REQUEST] model={MODEL_ID}\n{_format_request_for_log(messages)}",
            flush=True,
        )
    keys = _key_candidates()
    last_error: Exception | None = None
    for offset in range(len(keys)):
        index = (_preferred_key_index + offset) % len(keys)
        client = _client_for(keys[index])
        try:
            with _LLM_SEMAPHORE:
                try:
                    response = client.chat.completions.create(
                        model=MODEL_ID,
                        temperature=0,
                        response_format={"type": "json_object"},
                        messages=messages,
                        timeout=REQUEST_TIMEOUT_S,
                    )
                except BadRequestError:
                    logger.info(
                        "Gateway rejected response_format — retrying without JSON mode"
                    )
                    response = client.chat.completions.create(
                        model=MODEL_ID,
                        temperature=0,
                        messages=messages,
                        timeout=REQUEST_TIMEOUT_S,
                    )
            content = response.choices[0].message.content
            if not content:
                raise ValueError("Empty completion from gateway")
            _preferred_key_index = index
            if _verbose():
                print(f"[LLM RAW RESPONSE]\n{content}", flush=True)
            return content
        except OpenAIError as exc:
            if _is_quota_error(exc) and offset < len(keys) - 1:
                logger.warning("API key #%d quota-limited — rotating key", index + 1)
                last_error = exc
                continue
            raise
    raise last_error if last_error is not None else RuntimeError("No API key configured")


# --- Media handling for vision (download -> base64 data URI) -----------------------


@dataclass(frozen=True)
class _MediaChoice:
    fetch_url: str
    is_frame: bool  # True when judging a video via its preview frame
    preview: str | None  # what the UI should show as the analyzed thumbnail


def _select_media(report: RawReport) -> _MediaChoice | None:
    """Pick the best analyzable media: image first, then a video's preview frame."""
    for item in report.media:
        if item.type == "image" and (item.url or item.preview_url):
            url = item.url or item.preview_url or ""
            return _MediaChoice(url, False, item.preview_url or item.url)
    for item in report.media:
        if item.type in ("video", "gifv") and item.preview_url:
            return _MediaChoice(item.preview_url, True, item.preview_url)
    if _is_image_url(report.media_url):
        assert report.media_url is not None
        return _MediaChoice(report.media_url, False, report.media_url)
    return None


def _is_image_url(url: str | None) -> bool:
    return url is not None and url.lower().split("?")[0].endswith(IMAGE_SUFFIXES)


def _http_get_bytes(url: str) -> tuple[bytes, str]:
    """Fetch raw media bytes (the gateway cannot — stackit.de allow-list)."""
    with httpx.Client(
        timeout=MEDIA_TIMEOUT_S,
        follow_redirects=True,
        headers={"User-Agent": MEDIA_USER_AGENT},
    ) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.content, response.headers.get("content-type", "")


def _sniff_mime(data: bytes, header_content_type: str) -> str:
    """Magic-bytes first (feeds lie about content types), header as fallback."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    header = header_content_type.split(";")[0].strip().lower()
    if header.startswith("image/"):
        return header
    raise ValueError(f"Not an image (content-type {header_content_type!r})")


def _media_data_uri(url: str) -> str:
    """Download + validate + inline-encode one image for the vision call."""
    data, header_content_type = _http_get_bytes(url)
    if len(data) < MIN_MEDIA_BYTES:
        raise ValueError(f"Media too small ({len(data)} bytes) — likely an error page")
    if len(data) > MAX_MEDIA_BYTES:
        raise ValueError(f"Media too large ({len(data)} bytes > {MAX_MEDIA_BYTES})")
    mime = _sniff_mime(data, header_content_type)
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


# --- LLM analysis -------------------------------------------------------------------


def _build_messages(
    report: RawReport, data_uri: str | None, is_frame: bool
) -> list[dict[str, Any]]:
    """System prompt + the raw report text with brief context for plausibility."""
    system = SYSTEM_PROMPT
    if data_uri is not None:
        frame_note = FRAME_NOTE if is_frame else ""
        system += VISION_ADDENDUM.format(frame_note=frame_note)
    user_text = (
        f"Source: {report.source}\n"
        f"Author: {report.author}\n"
        f"Claimed position: lat {report.lat}, lon {report.lon}\n"
        f"Posted (UTC): {report.timestamp.isoformat()}\n"
        f"Report text:\n{report.text}"
    )
    user_content: Any = user_text
    if data_uri is not None:
        user_content = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": data_uri}},
        ]
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]

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
    """Live LLM analysis of one report (text + optional base64 image/frame).

    Raises on infra failure (caller falls back to heuristics); returns an
    'AI Parsing Error' debunk Assessment when the model's output is malformed.
    """
    if _over_budget():  # skip media download too once the budget is spent
        raise LLMBudgetExceeded(f"LLM budget of {llm_call_budget()} calls exhausted")
    choice = _select_media(report) if vision_enabled() else None
    data_uri: str | None = None
    if choice is not None:
        try:
            data_uri = _media_data_uri(choice.fetch_url)
        except Exception as exc:  # noqa: BLE001 — media problems never sink a report
            logger.warning(
                "Media fetch failed for %s (%s) — analyzing text-only",
                report.id,
                exc,
            )
            choice = None

    try:
        raw = _chat_completion(
            _build_messages(
                report, data_uri, is_frame=choice.is_frame if choice else False
            )
        )
    except OpenAIError:
        if data_uri is None:
            raise
        # An oversized/odd data URI must not sink the report — retry text-only.
        logger.warning("Vision call failed for %s — retrying text-only", report.id)
        choice = None
        data_uri = None
        raw = _chat_completion(_build_messages(report, None, is_frame=False))

    try:
        analysis = LLMAnalysis.model_validate_json(_strip_code_fences(raw))
    except ValidationError:
        logger.warning("Unparseable LLM output for %s: %.200s", report.id, raw)
        return Assessment(False, "AI Parsing Error", 0.0)

    # Pretty-print the structured verdict, with the 0-100% trust score made explicit.
    trustworthiness_level = max(1, min(5, round(analysis.credibility_score * 5)))
    verdict = {
        "report_id": report.id,
        "author": report.author,
        "trustworthiness_level": trustworthiness_level,
        "is_credible": analysis.is_credible,
        "event_type": analysis.event_type,
        "credibility_score": analysis.credibility_score,
        "reason_flagged": analysis.reason_flagged,
        "rationale": analysis.rationale,
        "media_consistency": analysis.media_consistency,
    }
    print(
        f"[LLM VERDICT]\n{json.dumps(verdict, indent=2, ensure_ascii=False)}",
        flush=True,
    )

    event_type = analysis.event_type.strip().lower() or None
    rationale = analysis.rationale.strip() or None
    media_note = (
        analysis.media_consistency.strip()
        if (data_uri is not None and analysis.media_consistency)
        else None
    )
    analyzed_media = (choice.preview or choice.fetch_url) if choice else None
    if analysis.is_credible:
        return Assessment(
            True,
            None,
            analysis.credibility_score,
            event_type,
            rationale,
            media_note,
            analyzed_media,
        )
    return Assessment(
        False,
        analysis.reason_flagged or "Flagged as non-credible by the AI analyst",
        analysis.credibility_score,
        event_type,
        rationale,
        media_note,
        analyzed_media,
    )


# --- Heuristic layer ---------------------------------------------------------------


def _assess_heuristics(report: RawReport) -> Assessment:
    """Deterministic metadata checks; returns the first rule violated, or credible."""
    text = report.text.lower()

    for marker in BOT_SPAM_MARKERS:
        if marker in text:
            return Assessment(False, f'Bot-spam phrasing detected: "{marker}"', 0.06)

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
    if not heuristic.credible:
        print(
            f"[FILTER] DEBUNKED (heuristic) {report.id} | {report.author} | {heuristic.reason}",
            flush=True,
        )
        return heuristic
    if not live_mode_enabled():
        print(
            f"[FILTER] PASSED (mock) {report.id} | {report.author} | score={heuristic.score}",
            flush=True,
        )
        return heuristic
    try:
        result = analyze_with_llm(report)
        verdict = "VERIFIED" if result.credible else "DEBUNKED (AI)"
        print(
            f"[FILTER] {verdict} {report.id} | {report.author} | "
            f"score={result.score:.2f} | {result.reason or 'ok'}",
            flush=True,
        )
        return result
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


def annotate_report(report: RawReport, assessment: Assessment) -> RawReport:
    """Stamp the AI verdict context onto the report itself: event-type
    refinement plus rationale/media note. Because these ride inside the
    persisted report JSON, they survive snapshot rebuilds and restarts."""
    updated = apply_event_type(report, assessment)
    changes: dict[str, Any] = {}
    if assessment.rationale:
        changes["ai_rationale"] = assessment.rationale
    if assessment.media_consistency:
        changes["ai_media_note"] = assessment.media_consistency
    # The AI's own credibility score, only when the live analyst actually ran
    # (a rationale is present): heuristic-mode scores must not be mislabeled.
    if assessment.rationale is not None:
        changes["ai_credibility"] = assessment.score
    return updated.model_copy(update=changes) if changes else updated


def filter_reports(
    reports: list[RawReport],
) -> tuple[list[RawReport], list[DebunkedReport]]:
    """Split raw reports into (credible, debunked)."""
    credible: list[RawReport] = []
    debunked: list[DebunkedReport] = []
    for report in reports:
        assessment = assess_report(report)
        annotated = annotate_report(report, assessment)
        if assessment.credible:
            credible.append(annotated)
        else:
            debunked.append(
                DebunkedReport(
                    id=annotated.id,
                    source=annotated.source,
                    author=annotated.author,
                    text=annotated.text,
                    event_type=annotated.event_type,
                    lat=annotated.lat,
                    lon=annotated.lon,
                    timestamp=annotated.timestamp,
                    reason_flagged=assessment.reason or "Failed credibility checks",
                    credibility_score=assessment.score,
                    url=annotated.url,
                    rationale=annotated.ai_rationale,
                    media_consistency=annotated.ai_media_note,
                    media_preview=assessment.analyzed_media
                    or annotated.first_media_preview(),
                )
            )
    return credible, debunked
