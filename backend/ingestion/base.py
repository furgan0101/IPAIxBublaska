"""Shared connector contract + small HTTP/text helpers for live ingestion."""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

import httpx

from schemas import MediaItem

_TAG_RE: re.Pattern[str] = re.compile(r"<[^>]+>")
_WS_RE: re.Pattern[str] = re.compile(r"\s+")


@dataclass(frozen=True)
class FetchedItem:
    """One upstream post/warning as fetched — before classification,
    geocoding, sector filtering and credibility checks (service.py)."""

    source: str
    source_id: str
    author: str
    text: str
    timestamp: datetime  # tz-aware UTC
    url: str | None = None
    lat: float | None = None
    lon: float | None = None
    event_type: str | None = None  # set when the upstream feed implies it
    media_url: str | None = None
    place_hint: str | None = None  # location string for the geocoder
    media: tuple[MediaItem, ...] = ()  # attached media (images/videos)


class Connector(Protocol):
    """A polled upstream source. `fetch` must never mutate shared state;
    failures are isolated per connector by the ingestion service."""

    name: str

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        ...


async def get_json(
    client: httpx.AsyncClient, url: str, params: dict[str, Any] | None = None
) -> Any:
    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json()


async def get_text(
    client: httpx.AsyncClient, url: str, params: dict[str, Any] | None = None
) -> str:
    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.text


def parse_utc(value: str) -> datetime:
    """ISO-8601 (with 'Z' or offset, Python 3.10-safe) -> tz-aware UTC."""
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def html_to_text(markup: str) -> str:
    """Strip tags + entities from feed/Mastodon HTML, collapse whitespace."""
    text = _TAG_RE.sub(" ", markup)
    text = html.unescape(text)
    return _WS_RE.sub(" ", text).strip()
