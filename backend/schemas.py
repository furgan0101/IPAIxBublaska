"""Pydantic schemas for the VOSTbw OSINT pipeline.

Data flow:
    feed/mock -> RawReport -> credibility filter -> credible | DebunkedReport
                              geo clustering     -> VerifiedIncident

Live injection (demo / future ingestion):
    ReportSubmission -> pipeline -> SubmissionResult
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

_IMAGE_SUFFIXES: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp", ".gif")


class MediaItem(BaseModel):
    """One piece of media attached to a report. Videos are judged via their
    preview frame (the gateway has no native video understanding)."""

    url: str
    type: Literal["image", "video", "gifv", "audio", "unknown"] = "image"
    preview_url: str | None = None


class RawReport(BaseModel):
    """A single unprocessed OSINT post (tweet / Telegram message / RSS item).

    `event_type` is pre-filled by the (mocked) LLM extraction step; in
    production the AI filter assigns it from the raw text.
    """

    id: str
    source: str = Field(description="Platform of origin, e.g. 'twitter' or 'telegram'")
    author: str
    text: str
    event_type: str = Field(description="Normalised event class, e.g. 'flood', 'fire'")
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    timestamp: datetime = Field(description="When the post was published (UTC)")
    exif_timestamp: datetime | None = Field(
        default=None, description="Capture time embedded in attached media, if any"
    )
    exif_lat: float | None = Field(default=None, description="GPS latitude from media EXIF")
    exif_lon: float | None = Field(default=None, description="GPS longitude from media EXIF")
    media_url: str | None = None
    url: str | None = Field(
        default=None, description="Link to the original post/release (live feeds)"
    )
    media: list[MediaItem] = Field(
        default_factory=list, description="Attached media (live feeds)"
    )
    ai_rationale: str | None = Field(
        default=None, description="AI analyst's 1–2 sentence verdict justification"
    )
    ai_media_note: str | None = Field(
        default=None, description="AI note: does the media match the claim?"
    )
    ai_credibility: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="AI analyst's own 0-1 credibility score (live AI mode only)",
    )

    def first_media_preview(self) -> str | None:
        """Best displayable thumbnail for the UI (never a raw video URL)."""
        for item in self.media:
            if item.preview_url:
                return item.preview_url
            if item.type == "image":
                return item.url
        if self.media_url and self.media_url.lower().split("?")[0].endswith(
            _IMAGE_SUFFIXES
        ):
            return self.media_url
        return None


class SOPTask(BaseModel):
    """One actionable checklist item for responders, tagged with the agency
    responsible (Polizei / Feuerwehr / THW / Rettungsdienst / LRA)."""

    task: str
    agency: str
    completed: bool = False


class SourceReport(BaseModel):
    """Compact view of one corroborating raw report, embedded in an incident
    so the dashboard can show a per-incident source timeline."""

    id: str
    source: str
    author: str
    text: str
    timestamp: datetime
    url: str | None = None
    media_preview: str | None = None
    ai_rationale: str | None = None
    ai_media_note: str | None = None
    ai_credibility: float | None = None


class VerifiedIncident(BaseModel):
    """A cluster of mutually corroborating reports promoted to a live incident."""

    id: str
    event_type: str
    lat: float = Field(description="Cluster centroid latitude")
    lon: float = Field(description="Cluster centroid longitude")
    confidence_score: float = Field(ge=0.0, le=1.0)
    ai_credibility: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Mean AI-analyst credibility across the clustered sources "
        "(live AI mode only); distinct from the corroboration confidence_score",
    )
    source_ids: list[str] = Field(description="IDs of the RawReports merged into this incident")
    report_count: int = Field(ge=1)
    first_seen: datetime
    last_seen: datetime
    summary: str
    severity: Literal["high", "moderate", "low"]
    action_hint: str = Field(description="Concise recommended responder action")
    dispatched: bool = Field(
        default=False, description="Whether this incident has been sent to the dispatcher"
    )
    dispatched_at: datetime | None = Field(
        default=None, description="When the incident was dispatched"
    )
    classified: bool = Field(
        default=False,
        description="Whether this is a sensitive security incident requiring "
        "information discipline",
    )
    sop_tasks: list[SOPTask] = Field(
        default_factory=list, description="Actionable checklist tasks for responders"
    )
    sources: list[SourceReport] = Field(
        default_factory=list, description="Corroborating reports, chronological"
    )


class DebunkedReport(BaseModel):
    """A report rejected by the credibility filter — fed to the
    'Disinformation Caught' panel on the dashboard."""

    id: str
    source: str
    author: str
    text: str
    event_type: str
    lat: float
    lon: float
    timestamp: datetime
    reason_flagged: str
    credibility_score: float = Field(ge=0.0, le=1.0)
    url: str | None = None
    rationale: str | None = Field(
        default=None, description="AI analyst's justification (live AI mode)"
    )
    media_consistency: str | None = Field(
        default=None, description="AI note on whether the media matches the claim"
    )
    media_preview: str | None = Field(
        default=None, description="Thumbnail of the analyzed media, if any"
    )


class ReportSubmission(BaseModel):
    """An incoming live report (demo injection now, real ingestion in Step 6).

    Mirrors RawReport but the server assigns the `id` and defaults `timestamp`
    to 'now', so a new post can be pushed through the full pipeline on demand.
    """

    source: str = "live"
    author: str
    text: str
    event_type: str
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    timestamp: datetime | None = None
    exif_timestamp: datetime | None = None
    exif_lat: float | None = None
    exif_lon: float | None = None
    media_url: str | None = None


class SubmissionResult(BaseModel):
    """What the pipeline decided about a freshly submitted report."""

    verdict: Literal["verified", "debunked"]
    report_id: str
    message: str
    incident_id: str | None = None
    confidence_score: float | None = None
    reason_flagged: str | None = None


# --- Live situational status tiles (header) ---------------------------------
# Real-time context for the focused location, sourced from official open APIs:
# DWD warnings (via Bright Sky), PEGELONLINE water levels, MobiData BW traffic.


class DwdStatus(BaseModel):
    """Current DWD weather-warning summary for a location (via Bright Sky)."""

    active: bool
    level: int = 0
    headline: str | None = None
    description: str | None = None
    timestamp: datetime | None = None
    url: str = "https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html"
    temperature: float | None = None


class PegelStatus(BaseModel):
    """Nearest water-level (Pegel) station and its current reading (PEGELONLINE)."""

    active: bool
    station: str | None = None
    water: str | None = None
    value: float | None = None
    unit: str | None = "cm"
    timestamp: datetime | None = None
    state: str | None = None
    url: str = "https://www.hvz.baden-wuerttemberg.de"


class MobiDataStatus(BaseModel):
    """Traffic / roadworks warnings near a location (MobiData BW open data)."""

    active: bool
    count: int = 0
    road: str | None = None
    location: str | None = None
    description: str | None = None
    distance_km: float | None = None
    url: str = "https://www.verkehrsinfo-bw.de"
