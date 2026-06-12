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

# --- Statewide Baden-Württemberg presets ------------------------------------
# Opt in from backend/.env with the shorthands NINA_ARS=08* and
# PRESSEPORTAL_FEEDS=bw instead of pasting the full lists (see _expand).

# All 44 BW Stadt-/Landkreise as 12-digit ARS (5-digit Kreisschlüssel + zeros).
BW_NINA_REGIONS: tuple[str, ...] = (
    # Regierungsbezirk Stuttgart
    "081110000000", "081150000000", "081160000000", "081170000000",
    "081180000000", "081190000000", "081210000000", "081250000000",
    "081260000000", "081270000000", "081280000000", "081350000000",
    "081360000000",
    # Regierungsbezirk Karlsruhe
    "082110000000", "082120000000", "082150000000", "082160000000",
    "082210000000", "082220000000", "082250000000", "082260000000",
    "082310000000", "082350000000", "082360000000", "082370000000",
    # Regierungsbezirk Freiburg
    "083110000000", "083150000000", "083160000000", "083170000000",
    "083250000000", "083260000000", "083270000000", "083350000000",
    "083360000000", "083370000000",
    # Regierungsbezirk Tübingen
    "084150000000", "084160000000", "084170000000", "084210000000",
    "084250000000", "084260000000", "084350000000", "084360000000",
    "084370000000",
)

# All 13 BW regional police HQ newsrooms + Polizeipräsidium Einsatz (statewide).
_BW_POLICE_DIENSTSTELLEN: tuple[str, ...] = (
    "110969",  # Aalen
    "110970",  # Freiburg
    "110971",  # Heilbronn
    "110972",  # Karlsruhe
    "110973",  # Konstanz
    "110974",  # Ludwigsburg
    "110975",  # Offenburg
    "110976",  # Reutlingen
    "110977",  # Stuttgart
    "110979",  # Ulm
    "110981",  # Einsatz (statewide operations)
    "14915",   # Mannheim
    "137462",  # Pforzheim
    "138081",  # Ravensburg
)
BW_PRESSEPORTAL_FEEDS: tuple[str, ...] = tuple(
    f"https://www.presseportal.de/rss/dienststelle_{nr}.rss2"
    for nr in _BW_POLICE_DIENSTSTELLEN
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


def _expand(
    values: tuple[str, ...], aliases: dict[str, tuple[str, ...]]
) -> tuple[str, ...]:
    """Replace shorthand tokens (e.g. NINA_ARS=08*) with their preset list,
    pass everything else through, and de-duplicate preserving order."""
    out: list[str] = []
    for value in values:
        out.extend(aliases.get(value.lower(), (value,)))
    return tuple(dict.fromkeys(out))


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

    @classmethod
    def from_env(cls) -> "IngestionSettings":
        db_raw = os.getenv("FEEDS_DB_PATH", "data/livefeeds.db")
        db_path = Path(db_raw)
        if not db_path.is_absolute():
            db_path = BACKEND_DIR / db_path
        return cls(
            enabled=_flag("FEEDS_ENABLED", default=False),
            poll_interval_s=max(30.0, _number("FEEDS_POLL_INTERVAL_S", 120.0)),
            retention_hours=max(1.0, _number("FEEDS_RETENTION_HOURS", 24.0)),
            sector_lat=_number("SECTOR_LAT", DEFAULT_SECTOR_LAT),
            sector_lon=_number("SECTOR_LON", DEFAULT_SECTOR_LON),
            sector_radius_km=max(1.0, _number("SECTOR_RADIUS_KM", 40.0)),
            db_path=db_path,
            nina_regions=_expand(
                _csv("NINA_ARS", DEFAULT_NINA_REGIONS),
                {"08*": BW_NINA_REGIONS, "bw": BW_NINA_REGIONS},
            ),
            presseportal_feeds=_expand(
                _csv("PRESSEPORTAL_FEEDS", DEFAULT_PRESSEPORTAL_FEEDS),
                {"bw": BW_PRESSEPORTAL_FEEDS},
            ),
            mastodon_instance=os.getenv(
                "MASTODON_INSTANCE", "https://mastodon.social"
            ).rstrip("/"),
            mastodon_tags=_csv("MASTODON_TAGS", DEFAULT_MASTODON_TAGS),
            nominatim_enabled=_flag("NOMINATIM_ENABLED", default=True),
            request_timeout_s=max(3.0, _number("FEEDS_TIMEOUT_S", 15.0)),
            user_agent=os.getenv(
                "FEEDS_USER_AGENT",
                "VOSTbw-OSINT-Dashboard/0.3 (hackathon demo; situational awareness)",
            ),
        )
