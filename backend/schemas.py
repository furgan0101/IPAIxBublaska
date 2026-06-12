"""Pydantic schemas for the VOSTbw OSINT pipeline.

Data flow:
    mock_data.json -> RawReport -> credibility filter -> credible | DebunkedReport
                                   geo clustering     -> VerifiedIncident
"""
from __future__ import annotations

from datetime import datetime

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
