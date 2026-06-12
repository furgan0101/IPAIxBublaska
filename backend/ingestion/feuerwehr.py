"""Feuerwehr connector — fire & rescue press/operational releases via RSS.

The legal, keyless analogue to live operational chatter: German police radio is
encrypted BOS Digitalfunk (intercepting it is unlawful and infeasible), and no
statewide dispatch API exists. Fire brigades, however, publish on the public
Presseportal newsroom — often *during or right after* a deployment (fires,
floods, technical rescue, hazmat) — which runs more operationally than police
press releases. Opt in via FIRE_FEEDS in backend/.env (e.g. `FIRE_FEEDS=bw`).

Reuses the proven Presseportal RSS parsing (same platform, same title format
"FW-...: (Ort / Lkr. X) ..."), only retagging the channel as `feuerwehr` so the
dashboard attributes and scores it as its own authority source.
"""
from __future__ import annotations

from dataclasses import replace

import feedparser
import httpx

from ingestion.base import FetchedItem, get_text, html_to_text
from ingestion.config import IngestionSettings
from ingestion.presseportal import _MAX_ITEMS_PER_FEED, _to_item

SOURCE: str = "feuerwehr"


class FeuerwehrConnector:
    name: str = "feuerwehr"

    def __init__(self, settings: IngestionSettings) -> None:
        self._feeds = settings.fire_feeds

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        items: list[FetchedItem] = []
        for feed_url in self._feeds:
            raw = await get_text(client, feed_url)
            parsed = feedparser.parse(raw)
            newsroom = html_to_text(
                str(parsed.feed.get("title", "Feuerwehr"))
            ).replace("Presseportal.de - ", "")
            for entry in parsed.entries[:_MAX_ITEMS_PER_FEED]:
                item = _to_item(entry, newsroom)
                if item is not None:
                    items.append(replace(item, source=SOURCE))
        return items
