"""Two-stage geocoding: offline gazetteer first, optional Nominatim fallback.

The gazetteer (ingestion.gazetteer) resolves the overwhelming majority of
sector-local place names with zero network calls. Only unresolved *structured*
place hints (e.g. the "(Ort, Straße / Lkr. X)" prefix of Presseportal titles)
are escalated to Nominatim — and only when NOMINATIM_ENABLED=true.

Nominatim usage follows the OSM usage policy: identifying User-Agent (set on
the shared client), >= 1.1 s between requests, every answer (hits AND misses)
cached in SQLite, queries bounded to the demo-sector viewbox so ambiguous
village names resolve locally or not at all.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone

import httpx

from ingestion import gazetteer
from ingestion.config import IngestionSettings
from ingestion.storage import FeedStore

logger = logging.getLogger("vost.ingestion.geocode")

NOMINATIM_URL: str = "https://nominatim.openstreetmap.org/search"
MIN_REQUEST_GAP_S: float = 1.1

# Bounding box around the demo sector (lon_left, lat_top, lon_right, lat_bottom).
SECTOR_VIEWBOX: str = "8.40,48.35,9.95,47.25"

# Tokens that are roads/qualifiers, not geocodable place names.
_NOISE_RE: re.Pattern[str] = re.compile(
    r"^(?:lkr\.?|landkreis|kreis|gemeinde|stadt|[abkl]\s?\d+\w*|b\d+|l\d+|k\d+)$",
    re.IGNORECASE,
)
_SPLIT_RE: re.Pattern[str] = re.compile(r"[,/;]")


def place_candidates(place_hint: str) -> list[str]:
    """Geocodable name candidates from a structured location hint, e.g.
    '(Talheim, K 5919, B 523 / Lkr. Tuttlingen)' -> ['Talheim', 'Tuttlingen']."""
    candidates: list[str] = []
    for part in _SPLIT_RE.split(place_hint):
        token = part.strip(" .()-–")
        token = re.sub(r"^(?:lkr\.?|landkreis|kreis)\s+", "", token, flags=re.IGNORECASE)
        if not token or len(token) < 3 or len(token) > 40:
            continue
        if _NOISE_RE.match(token) or any(ch.isdigit() for ch in token):
            continue
        if token not in candidates:
            candidates.append(token)
        if len(candidates) == 3:
            break
    return candidates


class Geocoder:
    """Gazetteer + cached, rate-limited Nominatim fallback."""

    def __init__(self, settings: IngestionSettings, store: FeedStore) -> None:
        self._settings = settings
        self._store = store
        self._lock = asyncio.Lock()
        self._last_request: float = 0.0
        # Scope bias (defaults = Konstanz demo sector; see Geocoder.set_scope).
        self._countrycodes: str = "de,ch"
        self._viewbox: str = SECTOR_VIEWBOX
        self._bounded: bool = True

    def set_scope(self, countrycodes: str, viewbox: str, *, bounded: bool) -> None:
        """Re-bias Nominatim to the active search scope. Large scopes use
        bounded=False (viewbox as preference, not a hard wall)."""
        self._countrycodes = countrycodes
        self._viewbox = viewbox
        self._bounded = bounded

    async def resolve(
        self,
        client: httpx.AsyncClient,
        place_hint: str | None,
        text: str,
    ) -> tuple[float, float] | None:
        """Best-effort coordinates for a report, or None (caller drops it).

        A structured place hint (e.g. the "(Ort / Lkr. X)" prefix of police
        releases) is fully resolved BEFORE the free-text scan: report text
        often names the issuing agency ("Polizei Konstanz: ..."), which must
        not win over the actual incident location in the hint."""
        if place_hint:
            hit = gazetteer.find(place_hint)
            if hit is not None:
                return hit
            if self._settings.nominatim_enabled:
                for candidate in place_candidates(place_hint):
                    coords = await self._cached_nominatim(client, candidate)
                    if coords is not None:
                        return coords
        return gazetteer.find(text) if text else None

    async def _cached_nominatim(
        self, client: httpx.AsyncClient, candidate: str
    ) -> tuple[float, float] | None:
        # Namespace the cache by full scope bias so a miss/hit from one region
        # cannot be reused after switching to another region with the same
        # country code.
        cache_key = (
            f"{self._countrycodes}:{self._viewbox}:{int(self._bounded)}:"
            f"{candidate.lower()}"
        )
        if self._store.geocode_has(cache_key):
            return self._store.geocode_get(cache_key)  # None == known miss
        coords = await self._query_nominatim(client, candidate)
        self._store.geocode_put(cache_key, coords, datetime.now(timezone.utc))
        return coords

    async def _query_nominatim(
        self, client: httpx.AsyncClient, place: str
    ) -> tuple[float, float] | None:
        async with self._lock:  # OSM policy: max ~1 request per second
            gap = MIN_REQUEST_GAP_S - (time.monotonic() - self._last_request)
            if gap > 0:
                await asyncio.sleep(gap)
            self._last_request = time.monotonic()
            try:
                response = await client.get(
                    NOMINATIM_URL,
                    params={
                        "q": place,
                        "format": "jsonv2",
                        "limit": "1",
                        "countrycodes": self._countrycodes,
                        "viewbox": self._viewbox,
                        "bounded": "1" if self._bounded else "0",
                    },
                )
                response.raise_for_status()
                results = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("Nominatim lookup failed for %r: %s", place, exc)
                return None
        if not results:
            return None
        try:
            return float(results[0]["lat"]), float(results[0]["lon"])
        except (KeyError, TypeError, ValueError):
            return None
