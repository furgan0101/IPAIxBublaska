"""Pydantic schemas for the VOSTbw OSINT pipeline.

Data flow:
    mock_data.json -> RawReport -> credibility filter -> credible | DebunkedReport
                                   geo clustering     -> VerifiedIncident

Live injection (demo / future ingestion):
    ReportSubmission -> pipeline -> SubmissionResult
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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


class SourceReport(BaseModel):
    """Compact view of one corroborating raw report, embedded in an incident
    so the dashboard can show a per-incident source timeline."""

    id: str
    source: str
    author: str
    text: str
    timestamp: datetime
    url: str | None = None


class VerifiedIncident(BaseModel):
    """A cluster of mutually corroborating reports promoted to a live incident."""

    id: str
    event_type: str
    lat: float = Field(description="Cluster centroid latitude")
    lon: float = Field(description="Cluster centroid longitude")
    confidence_score: float = Field(ge=0.0, le=1.0)
    source_ids: list[str] = Field(description="IDs of the RawReports merged into this incident")
    report_count: int = Field(ge=1)
    first_seen: datetime
    last_seen: datetime
    summary: str
    severity: Literal["high", "moderate", "low"]
    action_hint: str = Field(description="Concise recommended responder action")
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
