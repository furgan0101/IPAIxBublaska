"""Mock AI credibility filter.

Heuristic stand-in for the production LLM + Vision pipeline. Each rule mirrors
a check a real model (or a VOST analyst) would run:

  1. Linguistic — known bot/spam amplification phrasing.
  2. Temporal   — media EXIF capture time far older than the post -> recycled footage.
  3. Spatial    — media EXIF geotag conflicts with the claimed position.

API-KEY DROP-IN: set ANTHROPIC_API_KEY in backend/.env and replace the rule
block inside `assess_report` with a real LLM / Vision call. Keep the
`Assessment` return contract identical and nothing downstream changes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta

from geopy.distance import geodesic

from schemas import DebunkedReport, RawReport

# True once an API key is dropped in — the pipeline stays in mock mode either
# way for the MVP (guardrail: never burn credits during UI testing).
LIVE_AI_READY: bool = bool(os.getenv("ANTHROPIC_API_KEY"))

# Media captured more than this long before being posted is treated as
# recycled footage (the classic flood/fire disinformation pattern).
MAX_EXIF_AGE: timedelta = timedelta(hours=48)

# Media geotagged further than this (km, metric) from the claimed position
# is treated as a location conflict.
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


@dataclass(frozen=True)
class Assessment:
    """Outcome of the credibility check for a single report."""

    credible: bool
    reason: str | None
    score: float


def assess_report(report: RawReport) -> Assessment:
    """Score a single report; returns the first rule violated, or credible."""
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


def filter_reports(
    reports: list[RawReport],
) -> tuple[list[RawReport], list[DebunkedReport]]:
    """Split raw reports into (credible, debunked)."""
    credible: list[RawReport] = []
    debunked: list[DebunkedReport] = []
    for report in reports:
        assessment = assess_report(report)
        if assessment.credible:
            credible.append(report)
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
