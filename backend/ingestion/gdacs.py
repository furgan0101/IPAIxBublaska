"""GDACS connector - global disaster alerts (EC-JRC Global Disaster Alert and
Coordination System) via the public keyless RSS feed.

GDACS publishes near-real-time, pre-geocoded alerts for floods, earthquakes,
tropical cyclones, wildfires, droughts and volcanoes. Each RSS item carries a
georss:point ("lat lon"), a gdacs:eventtype code (FL, EQ, TC, WF, DR, VO) and a
gdacs:alertlevel (Green, Orange, Red). We map the codes that have a clean match
in the BW crisis taxonomy and skip the rest:

    FL -> flood, EQ -> earthquake, TC -> storm, WF -> wildfire
    DR, VO -> skipped (no clean taxonomy match)

The feed is global; the sector gate in service.py keeps only what is near the
configured sector. This connector is opt-in via FEEDS_GDACS_ENABLED so the
default Konstanz demo is not flooded with worldwide alerts.

Source: https://www.gdacs.org/xml/rss.xml (EC-JRC, public domain / CC BY 4.0).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import feedparser
import httpx

from ingestion.base import FetchedItem, get_text
from ingestion.config import IngestionSettings

#: GDACS event-type codes -> BW crisis taxonomy (KNOWN_EVENT_TYPES). Codes not
#: present here (e.g. DR drought, VO volcano) are skipped: no clean match.
_EVENT_TYPE_MAP: dict[str, str] = {
    "FL": "flood",
    "EQ": "earthquake",
    "TC": "storm",
    "WF": "wildfire",
}

_FEED_URL: str = "https://www.gdacs.org/xml/rss.xml"
_MAX_ITEMS: int = 60
_MAX_TEXT_LEN: int = 600
#: Fallback for a raw "lat lon" georss:point string if feedparser did not parse
#: it into the geometry "where" field.
_POINT_RE: re.Pattern[str] = re.compile(
    r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)"
)


class GdacsConnector:
    name: str = "gdacs"

    def __init__(self, settings: IngestionSettings) -> None:
        self._enabled = settings.gdacs_enabled

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        if not self._enabled:
            return []
        try:
            raw = await get_text(client, _FEED_URL)
        except Exception:
            # Network or HTTP failure: isolate per the connector contract.
            return []
        parsed = feedparser.parse(raw)
        items: list[FetchedItem] = []
        for entry in parsed.entries[:_MAX_ITEMS]:
            item = _to_item(entry)
            if item is not None:
                items.append(item)
        return items


def _coords(entry: Any) -> tuple[float, float] | None:
    """Return (lat, lon) from the georss:point, or None if absent/unparsable.

    feedparser normalises georss:point into entry["where"] as GeoJSON, i.e.
    coordinates ordered (lon, lat). We fall back to parsing the raw string when
    the geometry is missing.
    """
    where = entry.get("where") or {}
    coordinates = where.get("coordinates") if isinstance(where, dict) else None
    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        try:
            lon = float(coordinates[0])
            lat = float(coordinates[1])
            return lat, lon
        except (TypeError, ValueError):
            pass
    raw_point = entry.get("georss_point") or entry.get("point")
    if isinstance(raw_point, str):
        match = _POINT_RE.search(raw_point)
        if match is not None:
            try:
                return float(match.group(1)), float(match.group(2))
            except ValueError:
                return None
    return None


def _timestamp(entry: Any) -> datetime | None:
    """tz-aware UTC publish time; feedparser normalises struct_time to UTC."""
    published = entry.get("published_parsed") or entry.get("updated_parsed")
    if published is None:
        return None
    try:
        return datetime(*published[:6], tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _to_item(entry: Any) -> FetchedItem | None:
    code = str(entry.get("gdacs_eventtype") or "").strip().upper()
    event_type = _EVENT_TYPE_MAP.get(code)
    if event_type is None:
        return None  # DR, VO or unknown: no clean taxonomy match, skip.

    coords = _coords(entry)
    if coords is None:
        return None  # contract: every item must carry lat/lon.
    lat, lon = coords

    timestamp = _timestamp(entry)
    if timestamp is None:
        return None

    title = str(entry.get("title") or "").strip()
    link = str(entry.get("link") or "").strip() or None
    event_id = str(entry.get("gdacs_eventid") or "").strip()
    guid = str(entry.get("id") or "").strip()
    # Stable unique id: prefer the GDACS guid (e.g. "FL1103920"); otherwise
    # build one from event type + event id; last resort is the link.
    source_id = guid or (f"{code}{event_id}" if event_id else "") or link
    if not source_id or not title:
        return None

    alert_level = str(entry.get("gdacs_alertlevel") or "").strip()
    country = str(entry.get("gdacs_country") or "").strip()
    summary = str(entry.get("summary") or entry.get("description") or "").strip()

    text = _build_text(title, summary, alert_level, country)

    place_hint = country or None

    return FetchedItem(
        source="gdacs",
        source_id=source_id,
        author="GDACS (EC-JRC)",
        text=text[:_MAX_TEXT_LEN],
        timestamp=timestamp,
        url=link,
        lat=lat,
        lon=lon,
        event_type=event_type,
        place_hint=place_hint,
    )


def _build_text(
    title: str, summary: str, alert_level: str, country: str
) -> str:
    """Concise human summary; metric units are preserved from the source."""
    parts: list[str] = []
    if alert_level:
        parts.append(f"GDACS {alert_level} alert")
    elif country:
        parts.append("GDACS alert")
    headline = title or summary
    if headline:
        parts.append(headline)
    body = ": ".join(parts) if parts else (summary or country)
    if summary and summary not in body:
        body = f"{body} - {summary}"
    return body.strip()
