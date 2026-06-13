"""Mastodon connector — public hashtag timelines (keyless social OSINT).

Polls {instance}/api/v1/timelines/tag/{tag} for the configured hashtags.
This is the channel where citizen reports AND disinformation live, so posts
are deliberately passed through un-curated (bots included) — judging them is
exactly the job of the credibility filter downstream.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from ingestion.base import FetchedItem, get_json, html_to_text, parse_utc
from ingestion.config import IngestionSettings
from schemas import MediaItem

_LIMIT_PER_TAG: int = 20
_MIN_TEXT_LEN: int = 15
_MAX_TEXT_LEN: int = 600
_ACCEPTED_LANGUAGES: tuple[str | None, ...] = (None, "de", "en")


class MastodonConnector:
    name: str = "mastodon"

    def __init__(self, settings: IngestionSettings) -> None:
        self._instance = settings.mastodon_instance
        self._tags = settings.mastodon_tags

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        return await self.fetch_tags(client, self._tags)

    async def fetch_tags(
        self, client: httpx.AsyncClient, tags: Sequence[str]
    ) -> list[FetchedItem]:
        items: list[FetchedItem] = []
        seen: set[str] = set()
        for tag in tags:
            statuses = await get_json(
                client,
                f"{self._instance}/api/v1/timelines/tag/{quote(tag.lower())}",
                params={"limit": str(_LIMIT_PER_TAG)},
            )
            for status in statuses or []:
                item = _to_item(status)
                if item is not None and item.source_id not in seen:
                    seen.add(item.source_id)
                    items.append(item)
        return items


def _to_item(status: dict[str, Any]) -> FetchedItem | None:
    if status.get("reblog"):
        return None
    if status.get("language") not in _ACCEPTED_LANGUAGES:
        return None
    source_id = str(status.get("uri") or status.get("id") or "")
    created_at = status.get("created_at")
    if not source_id or not created_at:
        return None
    text = html_to_text(str(status.get("content", "")))
    if len(text) < _MIN_TEXT_LEN:
        return None
    account = status.get("account") or {}
    media = _extract_media(status)
    media_url = next((m.url for m in media if m.type == "image"), None) or next(
        (m.preview_url for m in media if m.preview_url), None
    )
    return FetchedItem(
        source="mastodon",
        source_id=source_id,
        author=f"@{account.get('acct', 'unknown')}",
        text=text[:_MAX_TEXT_LEN],
        timestamp=parse_utc(str(created_at)),
        url=status.get("url") or None,
        media_url=media_url,
        media=media,
    )


def _extract_media(status: dict[str, Any]) -> tuple[MediaItem, ...]:
    """Attachments (image/video/gifv with preview frames) + link-card image."""
    items: list[MediaItem] = []
    for attachment in status.get("media_attachments") or []:
        kind = str(attachment.get("type", ""))
        url = attachment.get("url") or attachment.get("preview_url")
        if kind in ("image", "video", "gifv") and url:
            items.append(
                MediaItem(
                    url=str(url),
                    type=kind,  # type: ignore[arg-type] — validated by Literal
                    preview_url=attachment.get("preview_url"),
                )
            )
    if not items:
        card = status.get("card") or {}
        card_image = card.get("image")
        if card_image:
            items.append(
                MediaItem(url=str(card_image), type="image", preview_url=str(card_image))
            )
    return tuple(items)
