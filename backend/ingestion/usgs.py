"""USGS connector - global earthquakes from the USGS real-time GeoJSON feed.

The U.S. Geological Survey publishes a keyless, public GeoJSON FeatureCollection
of recent earthquakes (magnitude 2.5+, past day). Each feature is pre-geocoded,
so items carry lat/lon directly and never need Nominatim.

Endpoint: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson
Docs: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from ingestion.base import FetchedItem, get_json
from ingestion.config import IngestionSettings

USGS_FEED_URL: str = (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
)


class UsgsConnector:
    name: str = "usgs"

    def __init__(self, settings: IngestionSettings) -> None:
        # No sector filtering here: the service layer applies the radius gate.
        # The feed is global and keyless, so settings is only kept for parity.
        self._settings = settings

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        try:
            payload = await get_json(client, USGS_FEED_URL)
        except (httpx.HTTPError, ValueError):
            return []

        if not isinstance(payload, dict):
            return []

        features = payload.get("features")
        if not isinstance(features, list):
            return []

        items: list[FetchedItem] = []
        for feature in features:
            item = self._to_item(feature)
            if item is not None:
                items.append(item)
        return items

    def _to_item(self, feature: Any) -> FetchedItem | None:
        if not isinstance(feature, dict):
            return None

        props = feature.get("properties")
        if not isinstance(props, dict):
            return None

        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            return None

        coords = geometry.get("coordinates")
        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            return None

        lon = self._as_float(coords[0])
        lat = self._as_float(coords[1])
        if lat is None or lon is None:
            return None
        depth_km = self._as_float(coords[2]) if len(coords) >= 3 else None

        source_id = self._stable_id(feature, props)
        if not source_id:
            return None

        timestamp = self._epoch_ms_to_utc(props.get("time"))
        if timestamp is None:
            return None

        mag = self._as_float(props.get("mag"))
        place = props.get("place")
        place_str = place.strip() if isinstance(place, str) and place.strip() else None
        url = props.get("url")
        url_str = url.strip() if isinstance(url, str) and url.strip() else None

        text = self._summary(mag, place_str, depth_km)

        return FetchedItem(
            source="usgs",
            source_id=source_id,
            author="USGS",
            text=text,
            timestamp=timestamp,
            url=url_str,
            lat=lat,
            lon=lon,
            event_type="earthquake",
            place_hint=place_str,
        )

    @staticmethod
    def _stable_id(feature: dict[str, Any], props: dict[str, Any]) -> str | None:
        raw_id = feature.get("id")
        if isinstance(raw_id, str) and raw_id.strip():
            return raw_id.strip()
        ids = props.get("ids")
        if isinstance(ids, str):
            parts = [p for p in ids.split(",") if p]
            if parts:
                return parts[0]
        code = props.get("code")
        if code is not None and str(code).strip():
            return str(code).strip()
        return None

    @staticmethod
    def _summary(mag: float | None, place: str | None, depth_km: float | None) -> str:
        mag_part = f"M {mag:.1f} earthquake" if mag is not None else "Earthquake"
        where = f" - {place}" if place else ""
        depth_part = f" (depth {depth_km:.0f} km)" if depth_km is not None else ""
        return f"{mag_part}{where}{depth_part}"

    @staticmethod
    def _as_float(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str) and value.strip():
            try:
                return float(value.strip())
            except ValueError:
                return None
        return None

    @staticmethod
    def _epoch_ms_to_utc(value: Any) -> datetime | None:
        if isinstance(value, bool):
            return None
        if not isinstance(value, (int, float)):
            return None
        try:
            return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc)
        except (ValueError, OverflowError, OSError):
            return None
