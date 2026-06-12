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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Sequence

import httpx
from geopy.distance import geodesic

from ingestion.base import Connector, FetchedItem
from ingestion.classify import classify
from ingestion.config import IngestionSettings
from ingestion.geocode import Geocoder
from ingestion.mastodon import MastodonConnector
from ingestion.nina import NinaConnector
from ingestion.presseportal import PresseportalConnector
from ingestion.storage import FeedStore, StoredReport, content_hash
from logic.geospatial import cluster_reports
from logic.guidance import action_hint
from logic.verification import Assessment, apply_event_type, assess_report
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
}

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

    # -- lifecycle ----------------------------------------------------------------

    async def startup(self) -> None:
        """Init the store and publish whatever survived the last run, so the
        dashboard has data immediately while the first poll happens."""
        await asyncio.to_thread(self._store.init)
        await self._rebuild_and_publish()

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

    async def aclose(self) -> None:
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
            known_keys = await asyncio.to_thread(self._store.known_keys)
            known_hashes = await asyncio.to_thread(self._store.known_hashes)
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
                if assessment.credible:
                    report = apply_event_type(report, assessment)
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
                # to the whole polled region, so pin it at the sector centre.
                coords = (self._settings.sector_lat, self._settings.sector_lon)
            if coords is None:
                return None, "unlocated"
            lat, lon = coords

        distance_km = geodesic(
            (lat, lon), (self._settings.sector_lat, self._settings.sector_lon)
        ).kilometers
        if distance_km > self._settings.sector_radius_km:
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
        self._publish([], [], [])
        return await self.poll_once()

    def status(self) -> dict[str, Any]:
        return {
            "last_poll_utc": self._last_poll_utc,
            "poll_interval_s": self._settings.poll_interval_s,
            "retention_hours": self._settings.retention_hours,
            "sector_radius_km": self._settings.sector_radius_km,
            "last_stats": self._last_stats,
            "connectors": [
                health.as_dict() for health in self._health.values()
            ],
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
    )
