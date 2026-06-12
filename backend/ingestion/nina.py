"""NINA connector — official German civil-protection warnings (BBK api31).

Polls https://warnung.bund.de/api31/dashboard/{ARS}.json per configured
region (12-digit ARS at district granularity; default Landkreis Konstanz) —
the federal aggregate of MoWaS, KATWARN, BIWAPP, DWD and police warnings.
Each warning is enriched with a map position from its CAP geometry
(warnings/{id}.geojson centroid); district-wide warnings without geometry are
placed at the sector centre by the ingestion service.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from ingestion.base import FetchedItem, get_json, parse_utc
from ingestion.classify import classify
from ingestion.config import IngestionSettings

BASE_URL: str = "https://warnung.bund.de/api31"
PUBLIC_PAGE: str = "https://warnung.bund.de/meldungen"

# When the headline alone is not classifiable, fall back by warning provider.
_PROVIDER_FALLBACK: dict[str, str] = {
    "DWD": "storm",  # German Weather Service
    "LHP": "flood",  # flood-portal warnings
}
_DEFAULT_EVENT: str = "infrastructure_failure"  # generic civil-protection notice


class NinaConnector:
    name: str = "nina"

    def __init__(self, settings: IngestionSettings) -> None:
        self._regions = settings.nina_regions
        self._geometry_cache: dict[str, tuple[float, float] | None] = {}

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        items: list[FetchedItem] = []
        seen: set[str] = set()
        for ars in self._regions:
            warnings = await get_json(client, f"{BASE_URL}/dashboard/{ars}.json")
            for entry in warnings or []:
                item = await self._to_item(client, entry)
                if item is not None and item.source_id not in seen:
                    seen.add(item.source_id)
                    items.append(item)
        return items

    async def _to_item(
        self, client: httpx.AsyncClient, entry: dict[str, Any]
    ) -> FetchedItem | None:
        warning_id = entry.get("id")
        payload_data = (entry.get("payload") or {}).get("data") or {}
        headline = (
            payload_data.get("headline")
            or (entry.get("i18nTitle") or {}).get("de")
            or ""
        ).strip()
        if not warning_id or not headline:
            return None
        if str(payload_data.get("msgType", "")).lower() == "cancel":
            return None
        sent = entry.get("sent") or entry.get("startDate")
        if not sent:
            return None
        provider = str(payload_data.get("provider") or "NINA").upper()
        event_type = classify(headline) or _PROVIDER_FALLBACK.get(
            provider, _DEFAULT_EVENT
        )
        coords = await self._geometry_centroid(client, str(warning_id))
        lat, lon = coords if coords is not None else (None, None)
        return FetchedItem(
            source="nina",
            source_id=str(warning_id),
            author=provider,
            text=headline,
            timestamp=parse_utc(str(sent)),
            url=PUBLIC_PAGE,
            lat=lat,
            lon=lon,
            event_type=event_type,
            place_hint=headline,
        )

    async def _geometry_centroid(
        self, client: httpx.AsyncClient, warning_id: str
    ) -> tuple[float, float] | None:
        """Centroid of the warning's CAP polygons (rough mean of vertices)."""
        if warning_id in self._geometry_cache:
            return self._geometry_cache[warning_id]
        coords: tuple[float, float] | None = None
        try:
            geojson = await get_json(
                client, f"{BASE_URL}/warnings/{quote(warning_id)}.geojson"
            )
            points: list[tuple[float, float]] = []
            for feature in geojson.get("features", []):
                _collect_points((feature.get("geometry") or {}).get("coordinates"), points)
            if points:
                coords = (
                    sum(p[0] for p in points) / len(points),
                    sum(p[1] for p in points) / len(points),
                )
        except (httpx.HTTPError, ValueError, AttributeError):
            coords = None
        self._geometry_cache[warning_id] = coords
        return coords


def _collect_points(node: Any, into: list[tuple[float, float]]) -> None:
    """Recursively collect (lat, lon) pairs from GeoJSON coordinate nesting."""
    if not isinstance(node, list):
        return
    if (
        len(node) >= 2
        and isinstance(node[0], (int, float))
        and isinstance(node[1], (int, float))
    ):
        into.append((float(node[1]), float(node[0])))  # GeoJSON is [lon, lat]
        return
    for child in node:
        _collect_points(child, into)
