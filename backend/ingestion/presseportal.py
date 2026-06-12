"""Presseportal "Blaulicht" connector — police & fire press releases via RSS.

Default feed: Polizeipräsidium Konstanz (dienststelle 110973), covering the
districts Konstanz, Tuttlingen, Rottweil and Schwarzwald-Baar. Release titles
carry a structured location prefix — "POL-KN: (Ort, Straße / Lkr. X) ..." —
which is extracted as the geocoder's place hint.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import feedparser
import httpx

from ingestion.base import FetchedItem, get_text, html_to_text
from ingestion.config import IngestionSettings
from schemas import MediaItem

_TITLE_LOCATION_RE: re.Pattern[str] = re.compile(r"\(([^)]{2,80})\)")
_MAX_ITEMS_PER_FEED: int = 30
_MAX_TEXT_LEN: int = 600


class PresseportalConnector:
    name: str = "presseportal"

    def __init__(self, settings: IngestionSettings) -> None:
        self._feeds = settings.presseportal_feeds

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        items: list[FetchedItem] = []
        for feed_url in self._feeds:
            raw = await get_text(client, feed_url)
            parsed = feedparser.parse(raw)
            newsroom = html_to_text(
                str(parsed.feed.get("title", "Presseportal"))
            ).replace("Presseportal.de - ", "")
            for entry in parsed.entries[:_MAX_ITEMS_PER_FEED]:
                item = _to_item(entry, newsroom)
                if item is not None:
                    items.append(item)
        return items


def _to_item(entry: feedparser.FeedParserDict, newsroom: str) -> FetchedItem | None:
    link = entry.get("link") or entry.get("id")
    title = html_to_text(str(entry.get("title", "")))
    if not link or not title:
        return None
    published = entry.get("published_parsed") or entry.get("updated_parsed")
    if published is None:
        return None
    # feedparser normalises struct_time to UTC.
    timestamp = datetime(*published[:6], tzinfo=timezone.utc)
    summary = html_to_text(str(entry.get("summary", "")))
    location_match = _TITLE_LOCATION_RE.search(title)
    place_hint = location_match.group(1) if location_match else None
    text = f"{title} — {summary}"[:_MAX_TEXT_LEN] if summary else title
    media = _extract_media(entry)
    return FetchedItem(
        source="presseportal",
        source_id=str(link),
        author=newsroom,
        text=text,
        timestamp=timestamp,
        url=str(link),
        place_hint=place_hint,
        media=media,
        media_url=media[0].url if media else None,
    )


def _extract_media(entry: feedparser.FeedParserDict) -> tuple[MediaItem, ...]:
    """Lead image from RSS enclosures / media:content, when the feed has one."""
    seen: set[str] = set()
    items: list[MediaItem] = []
    candidates: list[tuple[str | None, str | None]] = []
    for enclosure in entry.get("enclosures") or []:
        candidates.append((enclosure.get("href"), enclosure.get("type")))
    for content in entry.get("media_content") or []:
        candidates.append((content.get("url"), content.get("type") or "image"))
    for url, mime in candidates:
        if not url or url in seen:
            continue
        if mime is not None and not str(mime).lower().startswith("image"):
            continue
        seen.add(url)
        items.append(MediaItem(url=str(url), type="image"))
    return tuple(items)
