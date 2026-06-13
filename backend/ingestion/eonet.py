"""EONET connector - NASA open natural-event feed (keyless, global).

Polls https://eonet.gsfc.nasa.gov/api/v3/events?status=open , NASA's Earth
Observatory Natural Event Tracker. Each event carries a category
(wildfires, severeStorms, floods, volcanoes, ...) and a geometry[] track; the
latest geometry entry gives a pre-geocoded position (Point lon/lat, or a
representative point for a Polygon footprint). Categories without a match in
the BW crisis taxonomy (e.g. volcanoes) are skipped rather than invented.
"""
from __future__ import annotations

from typing import Any

import httpx

from ingestion.base import FetchedItem, get_json, parse_utc
from ingestion.config import IngestionSettings

EVENTS_URL: str = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open"

# EONET category id -> KNOWN_EVENT_TYPES (only mappable categories are kept).
_CATEGORY_MAP: dict[str, str] = {
    "wildfires": "wildfire",
    "severeStorms": "storm",
    "floods": "flood",
}


class EonetConnector:
    name: str = "eonet"

    def __init__(self, settings: IngestionSettings) -> None:
        # Kept for parity with the other connectors; EONET is global so no
        # per-sector query parameter is needed, the service filters by radius.
        self._timeout = settings.request_timeout_s

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        try:
            payload = await get_json(client, EVENTS_URL)
        except (httpx.HTTPError, ValueError):
            return []
        events = payload.get("events") if isinstance(payload, dict) else None
        items: list[FetchedItem] = []
        for event in events or []:
            if not isinstance(event, dict):
                continue
            item = self._to_item(event)
            if item is not None:
                items.append(item)
        return items

    def _to_item(self, event: dict[str, Any]) -> FetchedItem | None:
        event_id = event.get("id")
        title = str(event.get("title") or "").strip()
        if not event_id or not title:
            return None

        event_type = self._event_type(event.get("categories"))
        if event_type is None:
            return None  # category not in the taxonomy (e.g. volcanoes)

        geometry = self._latest_geometry(event.get("geometry"))
        if geometry is None:
            return None  # cannot place on the map without coordinates
        lon, lat, when = geometry

        timestamp = self._parse_when(when)
        if timestamp is None:
            return None

        category_title = self._category_title(event.get("categories"))
        text = f"{category_title}: {title} (lat {lat:.3f}, lon {lon:.3f})."
        url = event.get("link") if isinstance(event.get("link"), str) else None

        return FetchedItem(
            source="eonet",
            source_id=str(event_id),
            author="NASA EONET",
            text=text[:600],
            timestamp=timestamp,
            url=url,
            lat=lat,
            lon=lon,
            event_type=event_type,
            place_hint=title,
        )

    @staticmethod
    def _event_type(categories: Any) -> str | None:
        if not isinstance(categories, list):
            return None
        for category in categories:
            if isinstance(category, dict):
                mapped = _CATEGORY_MAP.get(str(category.get("id") or ""))
                if mapped is not None:
                    return mapped
        return None

    @staticmethod
    def _category_title(categories: Any) -> str:
        if isinstance(categories, list):
            for category in categories:
                if isinstance(category, dict):
                    cid = str(category.get("id") or "")
                    if cid in _CATEGORY_MAP:
                        title = str(category.get("title") or "").strip()
                        if title:
                            return title
        return "Natural event"

    @staticmethod
    def _latest_geometry(geometry: Any) -> tuple[float, float, Any] | None:
        """Representative (lon, lat, date) from the most recent track entry."""
        if not isinstance(geometry, list) or not geometry:
            return None
        for entry in reversed(geometry):
            if not isinstance(entry, dict):
                continue
            point = _representative_point(entry.get("type"), entry.get("coordinates"))
            if point is not None:
                return point[0], point[1], entry.get("date")
        return None

    @staticmethod
    def _parse_when(when: Any) -> Any:
        if not isinstance(when, str) or not when.strip():
            return None
        try:
            return parse_utc(when)
        except (ValueError, TypeError):
            return None


def _representative_point(geom_type: Any, coords: Any) -> tuple[float, float] | None:
    """Return (lon, lat) for a Point, or a footprint-mean for a Polygon."""
    if geom_type == "Point":
        if (
            isinstance(coords, list)
            and len(coords) >= 2
            and isinstance(coords[0], (int, float))
            and isinstance(coords[1], (int, float))
        ):
            return float(coords[0]), float(coords[1])
        return None
    if geom_type == "Polygon":
        if not isinstance(coords, list) or not coords:
            return None
        ring = coords[0]
        if not isinstance(ring, list):
            return None
        pts = [
            (float(p[0]), float(p[1]))
            for p in ring
            if isinstance(p, list)
            and len(p) >= 2
            and isinstance(p[0], (int, float))
            and isinstance(p[1], (int, float))
        ]
        # GeoJSON linear rings are closed: the final vertex repeats the first.
        # Drop that duplicate so it does not skew the representative mean.
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if not pts:
            return None
        return (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )
    return None
