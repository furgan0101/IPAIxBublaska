"""Real-time streaming sources: Mastodon WebSocket + Bluesky Jetstream.

Each source runs as an isolated asyncio task that pushes `FetchedItem`s onto
the ingestion service's queue; the service's single consumer reuses the exact
polling pipeline (normalise -> dedup -> assess -> store), so streamed and
polled posts are indistinguishable downstream.

Resilience model:
  - every stream reconnects with exponential backoff (1 s .. 60 s cap);
  - a Mastodon instance that rejects anonymous streaming (HTTP 401/403)
    degrades to short-interval polling of the same hashtags (~25 s), staying
    near real-time;
  - a blocked Bluesky firehose (e.g. network 403) is marked "blocked" and
    never crashes anything else.

Cost model: the firehose is pre-filtered HARD before anything reaches the
pipeline — sector keyword + language + crisis classifier. The service adds a
throughput cap on top, and the LLM budget (verification.LLM_MAX_CALLS) is the
final backstop.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Awaitable, Callable

import httpx
import websockets

from ingestion.base import FetchedItem, get_json, parse_utc
from ingestion.classify import classify
from ingestion.mastodon import status_to_item
from schemas import MediaItem

try:  # websockets >= 12
    from websockets.exceptions import InvalidStatus as _InvalidStatus
except ImportError:  # pragma: no cover — older library naming
    from websockets.exceptions import (  # type: ignore[no-redef,attr-defined]
        InvalidStatusCode as _InvalidStatus,
    )
from websockets.exceptions import InvalidURI as _InvalidURI

logger = logging.getLogger("vost.streaming")

BACKOFF_INITIAL_S: float = 1.0
BACKOFF_CAP_S: float = 60.0

_WS_KWARGS: dict[str, Any] = {
    "open_timeout": 15,
    "ping_interval": 30,
    "ping_timeout": 30,
    "close_timeout": 5,
    "max_size": 2**20,
}

_ACCEPTED_LANGS: frozenset[str] = frozenset({"de", "en"})
_MIN_TEXT_LEN: int = 15
_MAX_TEXT_LEN: int = 600


class StreamAuthRejected(Exception):
    """The endpoint refused the connection (auth/blocked) — do not retry."""


@dataclass
class StreamStatus:
    """Last-known state of one streaming connection (shown in /api/health)."""

    name: str
    state: str = "starting"
    events: int = 0
    last_event_utc: str | None = None
    detail: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "state": self.state,
            "events": self.events,
            "last_event_utc": self.last_event_utc,
            "detail": self.detail,
        }

    def mark_event(self) -> None:
        self.events += 1
        self.last_event_utc = datetime.now(timezone.utc).isoformat()


@dataclass
class StreamRateLimiter:
    """Sliding-window cap on stream analyses (deferred posts are picked up by
    the regular poll later; firehose-only posts are dropped + counted)."""

    per_minute: int
    _stamps: deque[float] = field(default_factory=deque)

    def allow(self, now: float) -> bool:
        if self.per_minute <= 0:
            return True
        cutoff = now - 60.0
        while self._stamps and self._stamps[0] < cutoff:
            self._stamps.popleft()
        if len(self._stamps) >= self.per_minute:
            return False
        self._stamps.append(now)
        return True


def next_backoff(previous: float | None) -> float:
    """1, 2, 4, ... capped at BACKOFF_CAP_S."""
    if previous is None:
        return BACKOFF_INITIAL_S
    return min(previous * 2.0, BACKOFF_CAP_S)


async def supervise(
    name: str,
    status: StreamStatus,
    runner: Callable[[], Awaitable[None]],
    *,
    on_auth_rejected: Callable[[], Awaitable[None]] | None = None,
    sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Run a stream forever: reconnect with backoff, degrade on rejection.

    A failed stream NEVER propagates (except cancellation) — the poll loop
    and the other streams keep running regardless.
    """
    backoff: float | None = None
    while True:
        try:
            status.state = "connecting"
            await runner()
            backoff = None  # clean close -> immediate fresh reconnect
        except asyncio.CancelledError:
            raise
        except StreamAuthRejected as exc:
            status.detail = str(exc)[:200]
            if on_auth_rejected is None:
                status.state = "blocked"
                logger.warning("Stream %s blocked: %s — giving up", name, exc)
                return
            status.state = "fallback-polling"
            logger.warning(
                "Stream %s rejected (%s) — switching to short-interval polling",
                name,
                exc,
            )
            await on_auth_rejected()
            return
        except Exception as exc:  # noqa: BLE001 — isolate all stream failures
            backoff = next_backoff(backoff)
            status.state = "reconnecting"
            status.detail = f"{type(exc).__name__}: {exc}"[:200]
            logger.warning(
                "Stream %s error (%s) — reconnecting in %.0f s", name, exc, backoff
            )
            await sleeper(backoff)


def _http_status(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    code = getattr(response, "status_code", None)
    if code is None:
        code = getattr(exc, "status_code", None)
    return code if isinstance(code, int) else None


# --- Mastodon ------------------------------------------------------------------------


def parse_mastodon_frame(raw: str | bytes | dict[str, Any]) -> FetchedItem | None:
    """One WebSocket frame -> FetchedItem (only 'update' events carry posts).

    The payload is a JSON-encoded STRING of the same status object the REST
    timeline returns, so the existing parser is reused verbatim.
    """
    try:
        frame: Any = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(frame, dict) or frame.get("event") != "update":
        return None
    payload = frame.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return None
    if not isinstance(payload, dict):
        return None
    return status_to_item(payload)


def wss_from_redirect(exc_text: str) -> str | None:
    """Big instances redirect /api/v1/streaming to a dedicated streaming host
    with an https:// Location; extract it and swap the scheme to wss://."""
    match = re.search(r"https://[^\s'\"]+", exc_text)
    if match is None:
        return None
    return match.group(0).replace("https://", "wss://", 1)


async def _mastodon_socket_loop(
    url: str,
    instance: str,
    tags: tuple[str, ...],
    queue: "asyncio.Queue[FetchedItem]",
    status: StreamStatus,
) -> None:
    try:
        async with websockets.connect(url, **_WS_KWARGS) as socket:
            for tag in tags:
                await socket.send(
                    json.dumps({"type": "subscribe", "stream": "hashtag", "tag": tag})
                )
            status.state = "connected"
            status.detail = None
            logger.info("Mastodon stream connected: %s (%d tags)", url, len(tags))
            async for raw in socket:
                item = parse_mastodon_frame(raw)
                if item is not None:
                    status.mark_event()
                    await queue.put(item)
    except _InvalidStatus as exc:
        code = _http_status(exc)
        if code in (401, 403, 404):
            raise StreamAuthRejected(f"{instance} HTTP {code}") from exc
        raise


async def run_mastodon_socket(
    instance: str,
    tags: tuple[str, ...],
    queue: "asyncio.Queue[FetchedItem]",
    status: StreamStatus,
) -> None:
    """One multiplexed WebSocket per instance; one subscribe frame per tag.

    Follows ONE redirect to a dedicated streaming host (https -> wss swap);
    anything still unusable degrades to the short-interval polling fallback.
    """
    url = instance.replace("https://", "wss://", 1) + "/api/v1/streaming"
    try:
        await _mastodon_socket_loop(url, instance, tags, queue, status)
    except _InvalidURI as exc:
        retry_url = wss_from_redirect(getattr(exc, "uri", "") or str(exc))
        if retry_url is None:
            raise StreamAuthRejected(f"{instance} redirected to non-ws URI") from exc
        logger.info("Mastodon %s redirected — retrying stream at %s", instance, retry_url)
        try:
            await _mastodon_socket_loop(retry_url, instance, tags, queue, status)
        except _InvalidURI as exc2:
            raise StreamAuthRejected(f"{instance} streaming unreachable") from exc2


async def run_mastodon_fallback_poll(
    instance: str,
    tags: tuple[str, ...],
    queue: "asyncio.Queue[FetchedItem]",
    status: StreamStatus,
    interval_s: float,
    timeout_s: float,
    user_agent: str,
) -> None:
    """Near-real-time fallback when the instance rejects anonymous streaming:
    short-interval REST polling of the same hashtag timelines. Dedup makes the
    overlap with the regular poll loop free."""
    status.state = "fallback-polling"
    async with httpx.AsyncClient(
        headers={"User-Agent": user_agent},
        timeout=timeout_s,
        follow_redirects=True,
    ) as client:
        while True:
            try:
                for tag in tags:
                    statuses = await get_json(
                        client,
                        f"{instance}/api/v1/timelines/tag/{tag}",
                        params={"limit": "20"},
                    )
                    for status_obj in statuses or []:
                        item = status_to_item(status_obj)
                        if item is not None:
                            status.mark_event()
                            await queue.put(item)
                status.detail = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — keep the fallback alive
                status.detail = f"{type(exc).__name__}: {exc}"[:200]
                logger.warning("Fallback poll %s failed: %s", instance, exc)
            await asyncio.sleep(interval_s)


# --- Bluesky Jetstream ------------------------------------------------------------------


@lru_cache(maxsize=8)
def _keyword_pattern(keywords: tuple[str, ...]) -> re.Pattern[str]:
    """Word-boundary matcher (longest-first) — substring matching would make
    short keywords like state names explode with false positives."""
    parts = sorted((re.escape(kw.lower()) for kw in keywords), key=len, reverse=True)
    return re.compile(r"\b(?:" + "|".join(parts) + r")\b")


def jetstream_to_item(
    event: dict[str, Any],
    sector_keywords: tuple[str, ...],
    languages: tuple[str, ...] = ("de", "en"),
) -> FetchedItem | None:
    """Firehose event -> FetchedItem, with the HARD pre-filter:
    create-op post + accepted language + sector keyword + crisis classifier."""
    if event.get("kind") != "commit":
        return None
    commit = event.get("commit") or {}
    if (
        commit.get("operation") != "create"
        or commit.get("collection") != "app.bsky.feed.post"
    ):
        return None
    if not sector_keywords:
        return None
    record = commit.get("record") or {}
    text = str(record.get("text") or "").strip()
    if len(text) < _MIN_TEXT_LEN:
        return None
    langs = record.get("langs") or []
    accepted_langs = frozenset(languages) or _ACCEPTED_LANGS
    if langs and not (
        {str(lang)[:2].lower() for lang in langs} & accepted_langs
    ):
        return None
    match = _keyword_pattern(sector_keywords).search(text.lower())
    if match is None:
        return None
    matched_place = match.group(0)
    if classify(text) is None:
        return None

    did = str(event.get("did") or "")
    rkey = str(commit.get("rkey") or "")
    created = record.get("createdAt")
    if not did or not rkey or not created:
        return None

    media: list[MediaItem] = []
    embed = record.get("embed") or {}
    if embed.get("$type") == "app.bsky.embed.images":
        for image in embed.get("images") or []:
            link = (((image.get("image") or {}).get("ref")) or {}).get("$link")
            if link:
                media.append(
                    MediaItem(
                        url=(
                            "https://cdn.bsky.app/img/feed_fullsize/plain/"
                            f"{did}/{link}@jpeg"
                        ),
                        type="image",
                    )
                )

    return FetchedItem(
        source="bluesky",
        source_id=f"at://{did}/app.bsky.feed.post/{rkey}",
        author=f"bsky:{did.split(':')[-1][:12]}",
        text=text[:_MAX_TEXT_LEN],
        timestamp=parse_utc(str(created)),
        url=f"https://bsky.app/profile/{did}/post/{rkey}",
        place_hint=matched_place,
        media=tuple(media),
        media_url=media[0].url if media else None,
    )


async def run_bluesky_socket(
    url: str,
    sector_keywords: tuple[str, ...],
    queue: "asyncio.Queue[FetchedItem]",
    status: StreamStatus,
    languages: tuple[str, ...] = ("de", "en"),
) -> None:
    """Subscribe to the Jetstream firehose; everything is filtered client-side."""
    try:
        async with websockets.connect(url, **_WS_KWARGS) as socket:
            status.state = "connected"
            status.detail = None
            logger.info("Bluesky Jetstream connected")
            async for raw in socket:
                try:
                    event = json.loads(raw)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                item = jetstream_to_item(event, sector_keywords, languages)
                if item is not None:
                    status.mark_event()
                    await queue.put(item)
    except _InvalidStatus as exc:
        code = _http_status(exc)
        if code in (401, 403):
            raise StreamAuthRejected(f"Jetstream HTTP {code}") from exc
        raise
