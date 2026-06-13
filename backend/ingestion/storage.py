"""SQLite persistence for the live ingestion layer.

One row per upstream report — deduplicated by stable upstream key AND by
normalised content hash — plus a geocode cache so Nominatim is never asked
the same question twice. The API request path never reads this DB: the
ingestion service rebuilds the in-memory snapshot after each poll; the DB
only makes ingested OSINT, verdicts and geocodes survive restarts.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from schemas import RawReport

_NORMALISE_RE: re.Pattern[str] = re.compile(r"[^a-z0-9äöüß]+")


def content_hash(text: str) -> str:
    """Stable hash of the normalised report text (catches cross-posts)."""
    normalised = _NORMALISE_RE.sub(" ", text.lower()).strip()[:400]
    return hashlib.sha1(normalised.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class StoredReport:
    """A persisted report together with its credibility verdict."""

    report: RawReport
    credible: bool
    reason: str | None
    score: float


@dataclass(frozen=True)
class DispatchState:
    """Persisted Leitstelle-handoff state for one incident. `completed_tasks`
    holds the SOP task descriptions ticked off at handoff (empty for an
    automatic alert, which dispatches without working the checklist)."""

    dispatched_at: datetime
    completed_tasks: list[str]


class FeedStore:
    """Thin synchronous SQLite wrapper (call via asyncio.to_thread from the
    event loop). Connections are short-lived per operation — simplest safe
    model for a low-volume background poller."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self._path), timeout=10.0)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def init(self) -> None:
        with self._connect() as con:
            con.execute(
                """CREATE TABLE IF NOT EXISTS reports (
                       key          TEXT PRIMARY KEY,
                       content_hash TEXT NOT NULL,
                       report_json  TEXT NOT NULL,
                       credible     INTEGER NOT NULL,
                       reason       TEXT,
                       score        REAL NOT NULL,
                       report_ts    TEXT NOT NULL,
                       ingested_at  TEXT NOT NULL
                   )"""
            )
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_reports_ts ON reports(report_ts)"
            )
            con.execute(
                """CREATE TABLE IF NOT EXISTS geocode_cache (
                       query       TEXT PRIMARY KEY,
                       lat         REAL,
                       lon         REAL,
                       resolved_at TEXT NOT NULL
                   )"""
            )
            con.execute(
                """CREATE TABLE IF NOT EXISTS dispatched_incidents (
                       incident_id     TEXT PRIMARY KEY,
                       dispatched_at   TEXT NOT NULL,
                       completed_tasks TEXT NOT NULL
                   )"""
            )
        con.close()

    # -- reports -------------------------------------------------------------

    def known_keys(self) -> set[str]:
        with self._connect() as con:
            rows = con.execute("SELECT key FROM reports").fetchall()
        con.close()
        return {row[0] for row in rows}

    def known_hashes(self) -> set[str]:
        with self._connect() as con:
            rows = con.execute("SELECT content_hash FROM reports").fetchall()
        con.close()
        return {row[0] for row in rows}

    def add_report(
        self,
        key: str,
        chash: str,
        report: RawReport,
        credible: bool,
        reason: str | None,
        score: float,
        ingested_at: datetime,
    ) -> None:
        with self._connect() as con:
            con.execute(
                "INSERT OR IGNORE INTO reports VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    key,
                    chash,
                    report.model_dump_json(),
                    1 if credible else 0,
                    reason,
                    score,
                    report.timestamp.isoformat(),
                    ingested_at.isoformat(),
                ),
            )
        con.close()

    def load_recent(self, cutoff: datetime) -> list[StoredReport]:
        with self._connect() as con:
            rows = con.execute(
                "SELECT report_json, credible, reason, score FROM reports "
                "WHERE report_ts >= ? ORDER BY report_ts ASC",
                (cutoff.isoformat(),),
            ).fetchall()
        con.close()
        return [
            StoredReport(
                report=RawReport.model_validate_json(row[0]),
                credible=bool(row[1]),
                reason=row[2],
                score=float(row[3]),
            )
            for row in rows
        ]

    def purge_before(self, cutoff: datetime) -> None:
        """Housekeeping: drop rows far outside the serving window."""
        with self._connect() as con:
            con.execute(
                "DELETE FROM reports WHERE report_ts < ?", (cutoff.isoformat(),)
            )
        con.close()

    def clear(self) -> None:
        with self._connect() as con:
            con.execute("DELETE FROM reports")
        con.close()

    # -- geocode cache ---------------------------------------------------------

    def geocode_has(self, query: str) -> bool:
        with self._connect() as con:
            row = con.execute(
                "SELECT 1 FROM geocode_cache WHERE query = ?", (query,)
            ).fetchone()
        con.close()
        return row is not None

    def geocode_get(self, query: str) -> tuple[float, float] | None:
        """Cached coordinates; None for both 'unknown' and 'known miss'
        (disambiguate with geocode_has)."""
        with self._connect() as con:
            row = con.execute(
                "SELECT lat, lon FROM geocode_cache WHERE query = ?", (query,)
            ).fetchone()
        con.close()
        if row is None or row[0] is None or row[1] is None:
            return None
        return float(row[0]), float(row[1])

    def geocode_put(
        self,
        query: str,
        coords: tuple[float, float] | None,
        resolved_at: datetime,
    ) -> None:
        lat, lon = coords if coords is not None else (None, None)
        with self._connect() as con:
            con.execute(
                "INSERT OR REPLACE INTO geocode_cache VALUES (?, ?, ?, ?)",
                (query, lat, lon, resolved_at.isoformat()),
            )
        con.close()

    # -- dispatched incidents --------------------------------------------------

    def set_dispatched(
        self,
        incident_id: str,
        dispatched_at: datetime,
        completed_tasks: list[str],
    ) -> None:
        """Record (or update) the dispatch state of one incident so a manual
        Leitstelle handoff — and its completed SOP checklist — survives a
        snapshot rebuild and a backend restart. `completed_tasks` is stored as
        a JSON array of task descriptions."""
        with self._connect() as con:
            con.execute(
                "INSERT OR REPLACE INTO dispatched_incidents VALUES (?, ?, ?)",
                (
                    incident_id,
                    dispatched_at.isoformat(),
                    json.dumps(completed_tasks, ensure_ascii=False),
                ),
            )
        con.close()

    def load_dispatched(self) -> dict[str, DispatchState]:
        """All persisted dispatch records, keyed by incident id."""
        with self._connect() as con:
            rows = con.execute(
                "SELECT incident_id, dispatched_at, completed_tasks "
                "FROM dispatched_incidents"
            ).fetchall()
        con.close()
        result: dict[str, DispatchState] = {}
        for incident_id, dispatched_at, completed_json in rows:
            try:
                completed = [str(task) for task in json.loads(completed_json)]
            except (ValueError, TypeError):
                completed = []
            result[incident_id] = DispatchState(
                dispatched_at=datetime.fromisoformat(dispatched_at),
                completed_tasks=completed,
            )
        return result

    def clear_dispatched(self) -> None:
        with self._connect() as con:
            con.execute("DELETE FROM dispatched_incidents")
        con.close()
