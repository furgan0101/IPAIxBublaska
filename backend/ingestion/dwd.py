"""DWD connector — official German weather warnings via Bright Sky API.

Bright Sky parses DWD's complex Open Data formats into a clean JSON API.
Polls https://api.brightsky.dev/alerts?lat={lat}&lon={lon} for the sector.
"""
from __future__ import annotations

from typing import Any

import httpx

from ingestion.base import FetchedItem, get_json, parse_utc
from ingestion.config import IngestionSettings


class DwdConnector:
    name: str = "dwd"

    def __init__(self, settings: IngestionSettings) -> None:
        self._lat = settings.sector_lat
        self._lon = settings.sector_lon

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        url = f"https://api.brightsky.dev/alerts?lat={self._lat}&lon={self._lon}"
        payload = await get_json(client, url)
        
        alerts = payload.get("alerts") or []
        items: list[FetchedItem] = []
        
        for alert in alerts:
            item = self._to_item(alert)
            if item:
                items.append(item)
        return items

    def _to_item(self, alert: dict[str, Any]) -> FetchedItem | None:
        alert_id = alert.get("id")
        headline = alert.get("headline", "").strip()
        description = alert.get("description", "").strip()
        
        if not alert_id or not headline:
            return None

        sent = alert.get("effective_utc") or alert.get("onset_utc")
        if not sent:
            return None

        # Determine event type based on headline/description heuristics
        # Bright Sky often provides a 'event' or 'category' if we look deeper,
        # but for now we rely on the global classifier + a weather fallback.
        text = f"{headline}: {description}"

        return FetchedItem(
            source="dwd",
            source_id=str(alert_id),
            author="DWD",
            text=text[:600],
            timestamp=parse_utc(str(sent)),
            url="https://www.dwd.de/DE/leistungen/gds/help/warnungen/cap_node.html",
            lat=self._lat, # Warning applies to the queried sector
            lon=self._lon,
            event_type="storm", # Fallback for weather warnings
            place_hint=headline,
        )
