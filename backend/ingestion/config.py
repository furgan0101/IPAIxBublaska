"""Typed configuration for the live ingestion layer (read from backend/.env).

FEEDS_ENABLED=true flips the API from the synthetic mock feed to real
open-data polling; every other knob has a Konstanz-sector default, so going
live is a one-line config change (hackathon guardrail: pure config flip).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BACKEND_DIR: Path = Path(__file__).resolve().parents[1]

# Konstanz demo sector (see CLAUDE.md).
DEFAULT_SECTOR_LAT: float = 47.6603
DEFAULT_SECTOR_LON: float = 9.1758

# Polizeipräsidium Konstanz newsroom (covers the districts Konstanz,
# Tuttlingen, Rottweil and Schwarzwald-Baar).
DEFAULT_PRESSEPORTAL_FEEDS: tuple[str, ...] = (
    "https://www.presseportal.de/rss/dienststelle_110973.rss2",
)

# NINA regions: 12-digit ARS keys at district granularity (Landkreis Konstanz).
DEFAULT_NINA_REGIONS: tuple[str, ...] = ("083350000000",)

DEFAULT_MASTODON_TAGS: tuple[str, ...] = (
    "konstanz",
    "bodensee",
    "hochwasser",
    "unwetter",
)

# Bluesky Jetstream firehose (keyless). Empty BLUESKY_JETSTREAM_URL disables it.
DEFAULT_BLUESKY_JETSTREAM_URL: str = (
    "wss://jetstream2.us-east.bsky.network/subscribe"
    "?wantedCollections=app.bsky.feed.post"
)

# Sector terms a firehose post must mention to be considered at all (cheap
# pre-filter long before any LLM is involved).
DEFAULT_BLUESKY_KEYWORDS: tuple[str, ...] = (
    "konstanz",
    "bodensee",
    "kreuzlingen",
    "radolfzell",
    "singen",
    "reichenau",
    "allensbach",
)


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.getenv(name, "")
    values = tuple(part.strip() for part in raw.split(",") if part.strip())
    return values or default


def _number(name: str, default: float) -> float:
    raw = os.getenv(name, "")
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class IngestionSettings:
    """All knobs of the live ingestion layer, resolved once at startup."""

    enabled: bool
    poll_interval_s: float
    retention_hours: float
    sector_lat: float
    sector_lon: float
    sector_radius_km: float
    db_path: Path
    nina_regions: tuple[str, ...]
    presseportal_feeds: tuple[str, ...]
    mastodon_instance: str
    mastodon_tags: tuple[str, ...]
    nominatim_enabled: bool
    request_timeout_s: float
    user_agent: str
    # --- real-time streaming (defaults keep existing tests/config valid) ---
    streaming_enabled: bool = False
    mastodon_stream_instances: tuple[str, ...] = ()
    bluesky_jetstream_url: str = ""
    bluesky_keywords: tuple[str, ...] = ()
    max_stream_analyses_per_min: int = 10
    stream_fallback_poll_s: float = 25.0
    search_scope: str = "konstanz-sector"

    @classmethod
    def from_env(cls) -> "IngestionSettings":
        db_raw = os.getenv("FEEDS_DB_PATH", "data/livefeeds.db")
        db_path = Path(db_raw)
        if not db_path.is_absolute():
            db_path = BACKEND_DIR / db_path
        mastodon_instance = os.getenv(
            "MASTODON_INSTANCE", "https://mastodon.social"
        ).rstrip("/")
        return cls(
            enabled=_flag("FEEDS_ENABLED", default=False),
            poll_interval_s=max(30.0, _number("FEEDS_POLL_INTERVAL_S", 120.0)),
            retention_hours=max(1.0, _number("FEEDS_RETENTION_HOURS", 24.0)),
            sector_lat=_number("SECTOR_LAT", DEFAULT_SECTOR_LAT),
            sector_lon=_number("SECTOR_LON", DEFAULT_SECTOR_LON),
            sector_radius_km=max(1.0, _number("SECTOR_RADIUS_KM", 40.0)),
            db_path=db_path,
            nina_regions=_csv("NINA_ARS", DEFAULT_NINA_REGIONS),
            presseportal_feeds=_csv(
                "PRESSEPORTAL_FEEDS", DEFAULT_PRESSEPORTAL_FEEDS
            ),
            mastodon_instance=mastodon_instance,
            mastodon_tags=_csv("MASTODON_TAGS", DEFAULT_MASTODON_TAGS),
            nominatim_enabled=_flag("NOMINATIM_ENABLED", default=True),
            request_timeout_s=max(3.0, _number("FEEDS_TIMEOUT_S", 15.0)),
            user_agent=os.getenv(
                "FEEDS_USER_AGENT",
                "VOSTbw-OSINT-Dashboard/0.3 (hackathon demo; situational awareness)",
            ),
            streaming_enabled=_flag("FEEDS_STREAMING", default=False),
            mastodon_stream_instances=_csv(
                "MASTODON_STREAM_INSTANCES", (mastodon_instance,)
            ),
            bluesky_jetstream_url=os.getenv(
                "BLUESKY_JETSTREAM_URL", DEFAULT_BLUESKY_JETSTREAM_URL
            ).strip(),
            bluesky_keywords=tuple(
                keyword.lower()
                for keyword in _csv("BLUESKY_KEYWORDS", DEFAULT_BLUESKY_KEYWORDS)
            ),
            max_stream_analyses_per_min=int(
                _number("MAX_STREAM_ANALYSES_PER_MIN", 10.0)
            ),
            stream_fallback_poll_s=max(
                10.0, _number("MASTODON_STREAM_FALLBACK_POLL_S", 25.0)
            ),
            search_scope=os.getenv("SEARCH_SCOPE", "konstanz-sector").strip()
            or "konstanz-sector",
        )
