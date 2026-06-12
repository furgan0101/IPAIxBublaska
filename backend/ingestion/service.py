"""Ingestion service: poll real feeds, verify, persist, publish the snapshot.

One cycle (every FEEDS_POLL_INTERVAL_S):

    fetch all connectors concurrently      (per-connector failure isolation)
    -> normalise: classify -> geocode -> sector filter        (drop + count)
    -> dedup against SQLite (upstream key + normalised content hash)
    -> credibility filter (logic.verification — heuristics + optional LLM)
    -> persist verdicts -> rebuild the last RETENTION_HOURS from the store
    -> publish (swap the in-memory snapshot served by the API)

The service touches the API layer only through the injected `publish`
callback, keeping ingestion / AI verification / API routing separable
(hackathon guardrail: clean pipeline separation).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from collections import deque
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Any, Callable, Sequence

import httpx

from ingestion.base import Connector, FetchedItem
from ingestion.classify import classify
from ingestion.config import IngestionSettings
from ingestion.geocode import Geocoder
from ingestion.mastodon import MastodonConnector
from ingestion.nina import NinaConnector
from ingestion.presseportal import PresseportalConnector
from ingestion.scopes import GROUP_REGIONS, SCOPES, Scope
from ingestion.storage import FeedStore, StoredReport, content_hash
from ingestion.streaming import (
    StreamRateLimiter,
    StreamStatus,
    run_bluesky_socket,
    run_mastodon_fallback_poll,
    run_mastodon_socket,
    supervise,
)
from logic.geospatial import cluster_reports
from logic.guidance import action_hint
from logic.verification import Assessment, annotate_report, assess_report
from schemas import DebunkedReport, RawReport, VerifiedIncident

logger = logging.getLogger("vost.ingestion")

Publish = Callable[
    [list[RawReport], list[VerifiedIncident], list[DebunkedReport]], None
]

#: Report-id prefix per channel (shown in the dashboard's source timeline).
ID_PREFIXES: dict[str, str] = {
    "nina": "NINA",
    "presseportal": "POL",
    "mastodon": "MSTDN",
    "bluesky": "BSKY",
}

#: Coalesce stream-triggered snapshot rebuilds: a burst publishes at most
#: once per this window.
STREAM_PUBLISH_DEBOUNCE_S: float = 2.0

#: Ring buffer size for the dashboard's "incoming posts" ticker.
STREAM_RECENT_LIMIT: int = 50

#: Official channels lift the cluster confidence to at least this floor —
#: a federal warning or police release IS the corroboration.
OFFICIAL_CONFIDENCE_FLOOR: dict[str, float] = {
    "nina": 0.90,
    "presseportal": 0.80,
}

DEBUNKED_LIMIT: int = 60
FUTURE_SKEW_TOLERANCE: timedelta = timedelta(minutes=10)

# "(Ort, Straße / Lkr. X)" location prefix — police style, also mirrored by
# news bots on social media. Used when a connector supplied no place hint.
_PAREN_HINT_RE: re.Pattern[str] = re.compile(r"\(([^)]{3,80})\)")


def default_connectors(settings: IngestionSettings) -> list[Connector]:
    return [
        NinaConnector(settings),
        PresseportalConnector(settings),
        MastodonConnector(settings),
    ]


@dataclass
class ConnectorHealth:
    """Last-known status of one connector, surfaced via /api/health."""

    name: str
    ok: bool = True
    fetched: int = 0
    error: str | None = None
    last_success_utc: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "ok": self.ok,
            "fetched": self.fetched,
            "error": self.error,
            "last_success_utc": self.last_success_utc,
        }


class IngestionService:
    """Owns the poll loop, the SQLite store and the snapshot rebuild."""

    def __init__(
        self,
        settings: IngestionSettings,
        connectors: Sequence[Connector],
        publish: Publish,
    ) -> None:
        self._settings = settings
        self._connectors = list(connectors)
        self._publish = publish
        self._store = FeedStore(settings.db_path)
        self._geocoder = Geocoder(settings, self._store)
        self._client: httpx.AsyncClient | None = None
        self._health: dict[str, ConnectorHealth] = {
            connector.name: ConnectorHealth(connector.name)
            for connector in self._connectors
        }
        self._poll_lock = asyncio.Lock()
        self._last_poll_utc: str | None = None
        self._last_stats: dict[str, int] = {}
        # Dedup caches shared by the poll loop and the stream consumer
        # (loaded once from SQLite, kept in sync on every insert).
        self._known_keys: set[str] | None = None
        self._known_hashes: set[str] | None = None
        # Stream-only negative cache: keys already dropped (not crisis/off
        # sector/...) so re-enqueued fallback-poll posts short-circuit.
        self._stream_dropped: set[str] = set()
        # --- real-time streaming state -------------------------------------
        self._stream_queue: asyncio.Queue[FetchedItem] = asyncio.Queue(maxsize=500)
        self._stream_tasks: list[asyncio.Task[None]] = []
        self._stream_status: dict[str, StreamStatus] = {}
        self._stream_recent: deque[dict[str, Any]] = deque(maxlen=STREAM_RECENT_LIMIT)
        self._stream_rate = StreamRateLimiter(settings.max_stream_analyses_per_min)
        self._stream_counters: dict[str, int] = {
            "accepted": 0,
            "filtered": 0,
            "duplicates": 0,
            "rate_deferred": 0,
        }
        self._accept_times: deque[float] = deque(maxlen=600)
        self._publish_event = asyncio.Event()
        # Active search scope (runtime-switchable via POST /api/scope).
        self._scope: Scope = self._initial_scope(settings)
        self._apply_scope_to_geocoder()

    # -- lifecycle ----------------------------------------------------------------

    async def startup(self) -> None:
        """Init the store and publish whatever survived the last run, so the
        dashboard has data immediately while the first poll happens."""
        await asyncio.to_thread(self._store.init)
        await self._rebuild_and_publish()
        self._start_streams()

    async def run(self) -> None:
        """Poll forever; one failed cycle must never kill the loop."""
        while True:
            try:
                stats = await self.poll_once()
                logger.info("Poll cycle complete: %s", stats)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — keep the poller alive
                logger.exception("Poll cycle failed")
            await asyncio.sleep(self._settings.poll_interval_s)

    async def _stop_streams(self) -> None:
        for task in self._stream_tasks:
            task.cancel()
        for task in self._stream_tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._stream_tasks.clear()
        self._stream_status.clear()

    async def aclose(self) -> None:
        await self._stop_streams()
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={"User-Agent": self._settings.user_agent},
                timeout=self._settings.request_timeout_s,
                follow_redirects=True,
            )
        return self._client

    # -- polling --------------------------------------------------------------------

    async def poll_once(self) -> dict[str, int]:
        """One full ingest cycle; returns drop/keep counters for /api/poll."""
        async with self._poll_lock:
            fetched = await self._fetch_all()
            stats: dict[str, int] = {
                "fetched": len(fetched),
                "new_verified": 0,
                "new_debunked": 0,
                "duplicates": 0,
                "not_crisis": 0,
                "unlocated": 0,
                "off_sector": 0,
                "stale": 0,
            }
            await self._ensure_seen_loaded()
            known_keys = self._known_keys
            known_hashes = self._known_hashes
            assert known_keys is not None and known_hashes is not None
            now = datetime.now(timezone.utc)

            for item in fetched:
                key = f"{item.source}:{item.source_id}"
                if key in known_keys:
                    stats["duplicates"] += 1
                    continue
                report, drop_reason = await self._normalise(item, key, now)
                if report is None:
                    stats[drop_reason] += 1
                    continue
                chash = content_hash(report.text)
                if chash in known_hashes:
                    stats["duplicates"] += 1
                    continue
                known_keys.add(key)
                known_hashes.add(chash)
                # Heuristics are instant; the optional live LLM call is run in
                # a thread so a slow gateway never blocks the event loop.
                assessment = await asyncio.to_thread(assess_report, report)
                # Stamp verdict context (event-type refinement, AI rationale,
                # media-consistency note) onto the persisted report itself.
                report = annotate_report(report, assessment)
                if assessment.credible:
                    stats["new_verified"] += 1
                else:
                    stats["new_debunked"] += 1
                await asyncio.to_thread(
                    self._store.add_report,
                    key,
                    chash,
                    report,
                    assessment.credible,
                    assessment.reason,
                    assessment.score,
                    now,
                )

            await self._rebuild_and_publish()
            self._last_poll_utc = now.isoformat()
            self._last_stats = stats
            return stats

    async def _ensure_seen_loaded(self) -> None:
        if self._known_keys is None:
            self._known_keys = await asyncio.to_thread(self._store.known_keys)
            self._known_hashes = await asyncio.to_thread(self._store.known_hashes)

    # -- search scope -------------------------------------------------------------------

    @staticmethod
    def _initial_scope(settings: IngestionSettings) -> Scope:
        """Preset from SEARCH_SCOPE, or the env-tunable Konstanz default."""
        if settings.search_scope != "konstanz-sector":
            preset = SCOPES.get(settings.search_scope)
            if preset is not None:
                return preset
            logger.warning(
                "Unknown SEARCH_SCOPE %r — falling back to konstanz-sector",
                settings.search_scope,
            )
        spread = 0.5  # purely informational bbox around the radius scope
        return Scope(
            id="konstanz-sector",
            label="Konstanz Sector",
            group=GROUP_REGIONS,
            mode="radius",
            bbox=(
                settings.sector_lat - spread,
                settings.sector_lon - spread * 1.5,
                settings.sector_lat + spread,
                settings.sector_lon + spread * 1.5,
            ),
            countrycodes="de,ch,at",
            languages=("de", "en"),
            keywords=settings.bluesky_keywords,
            radius_km=settings.sector_radius_km,
            tags=settings.mastodon_tags,
            center_override=(settings.sector_lat, settings.sector_lon),
        )

    def _apply_scope_to_geocoder(self) -> None:
        """Konstanz keeps the hard-bounded local viewbox; large scopes use the
        viewbox as a preference only (countrycodes do the constraining)."""
        self._geocoder.set_scope(
            self._scope.countrycodes,
            self._scope.viewbox(),
            bounded=self._scope.mode == "radius",
        )

    async def set_scope(self, scope: Scope) -> None:
        """Switch the search region at runtime: stop streams, re-bias the
        geocoder + social filters, wipe the store, restart streams fresh."""
        async with self._poll_lock:
            logger.info("Search scope -> %s (%s)", scope.id, scope.label)
            if scope.mode == "bbox" and (scope.bbox[2] - scope.bbox[0]) > 8.0:
                logger.info(
                    "Large scope selected — analysis caps remain enforced "
                    "(MAX_STREAM_ANALYSES_PER_MIN + LLM_MAX_CALLS)"
                )
            await self._stop_streams()
            self._scope = scope
            self._apply_scope_to_geocoder()
            for connector in self._connectors:
                if isinstance(connector, MastodonConnector):
                    connector.set_tags(scope.hashtags())
            await asyncio.to_thread(self._store.clear)
            self._known_keys = set()
            self._known_hashes = set()
            self._stream_dropped.clear()
            self._stream_recent.clear()
            self._stream_rate = StreamRateLimiter(
                self._settings.max_stream_analyses_per_min
            )
            for counter in self._stream_counters:
                self._stream_counters[counter] = 0
            self._publish([], [], [])
            self._start_streams()

    def scope_info(self) -> dict[str, Any]:
        return self._scope.as_dict()

    # -- real-time streaming -----------------------------------------------------------

    def _start_streams(self) -> None:
        """Spawn one supervised task per stream source + consumer + publisher."""
        if not self._settings.streaming_enabled:
            return
        scope_tags = self._scope.hashtags()
        for instance in self._settings.mastodon_stream_instances:
            host = instance.removeprefix("https://").removeprefix("http://")
            status = StreamStatus(name=f"mastodon:{host}")
            self._stream_status[status.name] = status
            runner = partial(
                run_mastodon_socket,
                instance,
                scope_tags,
                self._stream_queue,
                status,
            )
            fallback = partial(
                run_mastodon_fallback_poll,
                instance,
                scope_tags,
                self._stream_queue,
                status,
                self._settings.stream_fallback_poll_s,
                self._settings.request_timeout_s,
                self._settings.user_agent,
            )
            self._stream_tasks.append(
                asyncio.create_task(
                    supervise(status.name, status, runner, on_auth_rejected=fallback)
                )
            )
        if self._settings.bluesky_jetstream_url:
            status = StreamStatus(name="bluesky-jetstream")
            self._stream_status[status.name] = status
            runner = partial(
                run_bluesky_socket,
                self._settings.bluesky_jetstream_url,
                self._scope.keywords,
                self._stream_queue,
                status,
                self._scope.languages,
            )
            self._stream_tasks.append(
                asyncio.create_task(supervise(status.name, status, runner))
            )
        self._stream_tasks.append(asyncio.create_task(self._consume_streams()))
        self._stream_tasks.append(asyncio.create_task(self._stream_publisher()))
        logger.info(
            "Real-time streaming enabled: %d source(s)", len(self._stream_status)
        )

    async def _consume_streams(self) -> None:
        """Single consumer: streamed items go through the SAME pipeline as polls."""
        while True:
            item = await self._stream_queue.get()
            try:
                await self._ingest_stream_item(item)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — one bad item never kills the consumer
                logger.exception("Stream item failed: %s:%s", item.source, item.source_id)

    async def _ingest_stream_item(self, item: FetchedItem) -> None:
        """normalise -> dedup -> assess -> store for ONE streamed post, with a
        two-phase ticker entry ('analyzing' -> verdict) and a throughput cap."""
        async with self._poll_lock:  # serialize against poll cycles
            now = datetime.now(timezone.utc)
            await self._ensure_seen_loaded()
            assert self._known_keys is not None and self._known_hashes is not None
            key = f"{item.source}:{item.source_id}"
            if key in self._known_keys or key in self._stream_dropped:
                self._stream_counters["duplicates"] += 1
                return
            # Cheap filters FIRST (classify/geocode/sector) — the analysis rate
            # cap must only gate posts that would actually be analyzed.
            report, _drop_reason = await self._normalise(item, key, now)
            if report is None:
                self._stream_dropped.add(key)
                self._stream_counters["filtered"] += 1
                return
            chash = content_hash(report.text)
            if chash in self._known_hashes:
                self._stream_dropped.add(key)
                self._stream_counters["duplicates"] += 1
                return
            if not self._stream_rate.allow(time.monotonic()):
                # Deferred, not lost: the regular poll picks tag posts up later.
                self._stream_counters["rate_deferred"] += 1
                logger.info("Stream analysis cap hit — deferring %s", key)
                return
            self._known_keys.add(key)
            self._known_hashes.add(chash)

            entry: dict[str, Any] = {
                "id": report.id,
                "source": report.source,
                "author": report.author,
                "text": report.text[:240],
                "timestamp": report.timestamp.isoformat(),
                "url": report.url,
                "verdict": "analyzing",
                "credibility_score": None,
                "event_type": report.event_type,
                "reason": None,
            }
            self._stream_recent.append(entry)

            assessment = await asyncio.to_thread(assess_report, report)
            report = annotate_report(report, assessment)
            entry["verdict"] = "verified" if assessment.credible else "debunked"
            entry["credibility_score"] = assessment.score
            entry["event_type"] = report.event_type
            entry["reason"] = assessment.reason

            await asyncio.to_thread(
                self._store.add_report,
                key,
                chash,
                report,
                assessment.credible,
                assessment.reason,
                assessment.score,
                now,
            )
            self._stream_counters["accepted"] += 1
            self._accept_times.append(time.monotonic())
            self._publish_event.set()

    async def _stream_publisher(self) -> None:
        """Debounced snapshot rebuild: a burst publishes at most every ~2 s."""
        while True:
            await self._publish_event.wait()
            await asyncio.sleep(STREAM_PUBLISH_DEBOUNCE_S)
            self._publish_event.clear()
            await self._rebuild_and_publish()

    def _posts_per_min(self) -> int:
        cutoff = time.monotonic() - 60.0
        while self._accept_times and self._accept_times[0] < cutoff:
            self._accept_times.popleft()
        return len(self._accept_times)

    def recent_stream_posts(self) -> list[dict[str, Any]]:
        """Newest-first ticker entries for GET /api/stream/recent."""
        return list(reversed(self._stream_recent))

    async def _fetch_all(self) -> list[FetchedItem]:
        batches = await asyncio.gather(
            *(self._fetch_one(connector) for connector in self._connectors)
        )
        return [item for batch in batches for item in batch]

    async def _fetch_one(self, connector: Connector) -> list[FetchedItem]:
        health = self._health[connector.name]
        try:
            items = await connector.fetch(self.client())
        except Exception as exc:  # noqa: BLE001 — isolate connector failures
            logger.warning("Connector %s failed: %s", connector.name, exc)
            health.ok = False
            health.error = f"{type(exc).__name__}: {exc}"[:200]
            return []
        health.ok = True
        health.error = None
        health.fetched = len(items)
        health.last_success_utc = datetime.now(timezone.utc).isoformat()
        return items

    async def _normalise(
        self, item: FetchedItem, key: str, now: datetime
    ) -> tuple[RawReport | None, str]:
        """FetchedItem -> RawReport, or (None, drop_reason)."""
        timestamp = item.timestamp.astimezone(timezone.utc)
        if timestamp < now - timedelta(hours=self._settings.retention_hours):
            return None, "stale"
        if timestamp > now + FUTURE_SKEW_TOLERANCE:
            timestamp = now

        event_type = item.event_type or classify(item.text)
        if event_type is None:
            return None, "not_crisis"

        lat, lon = item.lat, item.lon
        if lat is None or lon is None:
            place_hint = item.place_hint
            if place_hint is None:
                hint_match = _PAREN_HINT_RE.search(item.text[:160])
                place_hint = hint_match.group(1) if hint_match else None
            coords = await self._geocoder.resolve(
                self.client(), place_hint, item.text
            )
            if coords is None and item.source == "nina":
                # District-wide official warning without geometry: it applies
                # to the whole polled region, so pin it at the scope centre.
                coords = self._scope.center
            if coords is None:
                return None, "unlocated"
            lat, lon = coords

        if not self._scope.contains(float(lat), float(lon)):
            return None, "off_sector"

        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8].upper()
        prefix = ID_PREFIXES.get(item.source, "LIVE")
        return (
            RawReport(
                id=f"{prefix}-{digest}",
                source=item.source,
                author=item.author[:80],
                text=item.text,
                event_type=event_type,
                lat=round(float(lat), 6),
                lon=round(float(lon), 6),
                timestamp=timestamp,
                media_url=item.media_url,
                url=item.url,
                media=list(item.media),
            ),
            "",
        )

    # -- snapshot -------------------------------------------------------------------

    async def _rebuild_and_publish(self) -> None:
        credible, incidents, debunked = await asyncio.to_thread(self._rebuild)
        self._publish(credible, incidents, debunked)

    def _rebuild(
        self,
    ) -> tuple[list[RawReport], list[VerifiedIncident], list[DebunkedReport]]:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=self._settings.retention_hours)
        self._store.purge_before(cutoff - timedelta(days=7))
        stored = self._store.load_recent(cutoff)
        credible = [entry.report for entry in stored if entry.credible]
        incidents = self._with_source_trust(cluster_reports(credible))
        debunked = [
            _to_debunked(entry) for entry in reversed(stored) if not entry.credible
        ][:DEBUNKED_LIMIT]
        return credible, incidents, debunked

    def _with_source_trust(
        self, incidents: list[VerifiedIncident]
    ) -> list[VerifiedIncident]:
        """Official channels raise the confidence floor of their clusters."""
        adjusted: list[VerifiedIncident] = []
        for incident in incidents:
            floor = max(
                (
                    OFFICIAL_CONFIDENCE_FLOOR.get(source.source, 0.0)
                    for source in incident.sources
                ),
                default=0.0,
            )
            if floor > incident.confidence_score:
                # An official channel is already authority-verified, so it
                # counts as its own corroboration (no "task recon first" hint).
                adjusted.append(
                    incident.model_copy(
                        update={
                            "confidence_score": floor,
                            "action_hint": action_hint(
                                incident.event_type,
                                max(incident.report_count, 2),
                                floor,
                            ),
                        }
                    )
                )
            else:
                adjusted.append(incident)
        return adjusted

    # -- integration hooks ------------------------------------------------------------

    def persist_manual(self, report: RawReport, assessment: Assessment) -> None:
        """Persist a manually injected report (POST /api/reports) so it
        survives the next snapshot rebuild and a backend restart."""
        self._store.add_report(
            key=f"manual:{report.id}",
            chash=content_hash(report.text),
            report=report,
            credible=assessment.credible,
            reason=assessment.reason,
            score=assessment.score,
            ingested_at=datetime.now(timezone.utc),
        )

    async def reset(self) -> dict[str, int]:
        """Demo reset in live mode: wipe the store and re-poll immediately."""
        await asyncio.to_thread(self._store.clear)
        self._known_keys = set()
        self._known_hashes = set()
        self._stream_dropped.clear()
        self._stream_recent.clear()
        self._stream_rate = StreamRateLimiter(self._settings.max_stream_analyses_per_min)
        for counter in self._stream_counters:
            self._stream_counters[counter] = 0
        self._publish([], [], [])
        return await self.poll_once()

    def status(self) -> dict[str, Any]:
        return {
            "last_poll_utc": self._last_poll_utc,
            "poll_interval_s": self._settings.poll_interval_s,
            "retention_hours": self._settings.retention_hours,
            "sector_radius_km": self._settings.sector_radius_km,
            "scope": self.scope_info(),
            "last_stats": self._last_stats,
            "connectors": [
                health.as_dict() for health in self._health.values()
            ],
            "streaming": {
                "enabled": self._settings.streaming_enabled,
                "posts_per_min": self._posts_per_min(),
                "queue_depth": self._stream_queue.qsize(),
                **self._stream_counters,
                "connections": [
                    status.as_dict() for status in self._stream_status.values()
                ],
            },
        }


def _to_debunked(entry: StoredReport) -> DebunkedReport:
    report = entry.report
    return DebunkedReport(
        id=report.id,
        source=report.source,
        author=report.author,
        text=report.text,
        event_type=report.event_type,
        lat=report.lat,
        lon=report.lon,
        timestamp=report.timestamp,
        reason_flagged=entry.reason or "Failed credibility checks",
        credibility_score=entry.score,
        url=report.url,
        rationale=report.ai_rationale,
        media_consistency=report.ai_media_note,
        media_preview=report.first_media_preview(),
    )
