"""VOSTbw OSINT Situational Awareness API.

Real OSINT only — there is no synthetic feed. `ingestion.IngestionService`
polls keyless open sources (NINA civil-protection warnings, Presseportal police
RSS, Mastodon hashtags) on an interval, runs every new report through the same
pipeline, and publishes the snapshot served below:

    live feeds --> RawReport models            (ingestion connectors)
               --> credibility filter          (logic.verification)
               --> 1 km / 60 min clustering    (logic.geospatial)
               --> /api/incidents + /api/debunked

Operator actions:
    POST /api/poll     -> trigger one ingest cycle on demand
    POST /api/reset    -> wipe the live store and re-poll the real feeds
    POST /api/reports  -> inject a single report through the full pipeline
    POST /api/incidents/{id}/dispatch -> manual Leitstelle handoff (marks the
        incident dispatched, completes its SOP checklist, prints the payload)

High-severity incidents with confidence >= 0.85 are dispatched automatically
([AUTO-ALERT] on the console); security-sensitive classes (terror, hostage,
CBRN) carry `classified=true` so the frontend enforces information discipline.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import AsyncIterator, TypedDict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# --- Console logging --------------------------------------------------------------
# Surface our own pipeline logs + every outbound gateway HTTP call so the live AI
# verification is visible in the server console. Set LOG_LEVEL=DEBUG in backend/.env
# for full OpenAI SDK request/response detail.
_LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
# httpx logs one INFO line per request ("HTTP Request: POST .../chat/completions 200 OK").
logging.getLogger("httpx").setLevel(logging.INFO)
# The OpenAI SDK emits full request/response bodies at DEBUG; honour OPENAI_LOG too.
logging.getLogger("openai").setLevel(_LOG_LEVEL)
logging.getLogger("vost.verification").setLevel(logging.DEBUG)

import httpx
from ingestion import IngestionService, IngestionSettings, default_connectors
from ingestion.geocode import Geocoder
from ingestion.storage import FeedStore
from logic.geospatial import RADIUS_KM, cluster_reports
from logic.verification import (
    ai_mode,
    annotate_report,
    assess_report,
    auto_dispatch,
    budget_status,
    filter_reports,
    should_auto_dispatch,
)
from schemas import (
    DebunkedReport,
    DwdStatus,
    MobiDataStatus,
    PegelStatus,
    RawReport,
    ReportSubmission,
    SubmissionResult,
    VerifiedIncident,
)

# Sector default for the live status tiles when no location is focused (Konstanz).
SECTOR_DEFAULT_LAT: float = 47.6603
SECTOR_DEFAULT_LON: float = 9.1758

# Local Next.js dev server origins (CORS).
ALLOWED_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


class PipelineResult(TypedDict):
    incidents: list[VerifiedIncident]
    debunked: list[DebunkedReport]


class PipelineState(TypedDict):
    credible: list[RawReport]
    incidents: list[VerifiedIncident]
    debunked: list[DebunkedReport]
    live_seq: int


# In-memory store. Credible raw reports are kept so live injections can be
# re-clustered against the existing set without re-reading the feed.
state: PipelineState = {"credible": [], "incidents": [], "debunked": [], "live_seq": 0}

# Live ingestion: created during lifespan; the sole source of all served data.
ingestion_service: IngestionService | None = None
_ingest_task: asyncio.Task[None] | None = None

# Geocoder is always available (uses local gazetteer + optional Nominatim).
_geocoder: Geocoder | None = None
_geo_client: httpx.AsyncClient | None = None


@dataclass(frozen=True)
class _DispatchRecord:
    """Dispatch is sticky per incident id: re-clustering rebuilds incidents
    from scratch, so the state must be re-applied from this registry. The
    registry is backed by SQLite (ingestion store), so dispatches survive a
    backend restart."""

    at: datetime
    # SOP task descriptions completed at handoff. Non-empty => manual handoff
    # (worked the checklist); empty => automatic alert (dispatch only).
    completed_tasks: tuple[str, ...] = ()


_dispatch_registry: dict[str, _DispatchRecord] = {}
# Live mode: the persisted dispatch table is loaded into the registry once,
# the first time a snapshot is (re)built, so a restart re-applies dispatches.
_dispatch_hydrated: bool = False


def _hydrate_dispatch_registry() -> None:
    """Load persisted dispatch state (live mode) into the in-memory registry,
    once. No-op in mock mode — there is no store to read."""
    global _dispatch_hydrated
    if _dispatch_hydrated or ingestion_service is None:
        return
    for incident_id, persisted in ingestion_service.load_dispatch_state().items():
        _dispatch_registry[incident_id] = _DispatchRecord(
            at=persisted.dispatched_at,
            completed_tasks=tuple(persisted.completed_tasks),
        )
    _dispatch_hydrated = True


def _persist_dispatch(record_id: str, record: _DispatchRecord) -> None:
    """Write a dispatch record through to the SQLite store (live mode only)."""
    if ingestion_service is not None:
        ingestion_service.record_dispatch(
            record_id, record.at, list(record.completed_tasks)
        )


def _apply_dispatch_state(
    incidents: list[VerifiedIncident],
) -> list[VerifiedIncident]:
    """Re-apply known dispatch state after (re-)clustering and fire the
    Automatic Alert Dispatch for newly qualifying incidents (high severity +
    confidence >= 0.85). The console alert prints once per incident."""
    _hydrate_dispatch_registry()
    result: list[VerifiedIncident] = []
    for incident in incidents:
        record = _dispatch_registry.get(incident.id)
        if record is not None:
            update: dict[str, object] = {"dispatched": True, "dispatched_at": record.at}
            if record.completed_tasks:
                done = set(record.completed_tasks)
                update["sop_tasks"] = [
                    task.model_copy(
                        update={"completed": task.completed or task.task in done}
                    )
                    for task in incident.sop_tasks
                ]
            incident = incident.model_copy(update=update)
        elif should_auto_dispatch(incident):
            incident = auto_dispatch(incident)
            record = _DispatchRecord(
                at=incident.dispatched_at or datetime.now(timezone.utc)
            )
            _dispatch_registry[incident.id] = record
            _persist_dispatch(incident.id, record)
        result.append(incident)
    return result


def _print_dispatch_payload(incident: VerifiedIncident) -> None:
    """Simulated handoff to the Integrierte Leitstelle (control centre)."""
    stamp = incident.dispatched_at or datetime.now(timezone.utc)
    rule = "=" * 74
    lines = [
        rule,
        "EMERGENCY DISPATCH PAYLOAD -> Integrierte Leitstelle Konstanz",
        rule,
        f"  Incident:    {incident.id}  ({incident.event_type})",
        f"  Severity:    {incident.severity.upper()}  |  "
        f"confidence {round(incident.confidence_score * 100)} %",
        f"  Position:    {incident.lat:.4f} N, {incident.lon:.4f} E  "
        f"(cluster radius {RADIUS_KM:.1f} km)",
        f"  Window:      {incident.first_seen:%Y-%m-%d %H:%M} – "
        f"{incident.last_seen:%H:%M} UTC  |  "
        f"{incident.report_count} corroborating report(s)",
        f"  Action hint: {incident.action_hint}",
        "  SOP tasks:",
        *(
            f"    [{'x' if task.completed else ' '}] {task.task} — {task.agency}"
            for task in incident.sop_tasks
        ),
    ]
    if incident.classified:
        lines.append(
            "  INFORMATION DISCIPLINE: ACTIVE — secure handoff to Police Command."
        )
    lines.append(f"  Dispatched:  {stamp:%Y-%m-%d %H:%M:%S} UTC")
    lines.append(rule)
    print("\n".join(lines), flush=True)


def _publish_snapshot(
    credible: list[RawReport],
    incidents: list[VerifiedIncident],
    debunked: list[DebunkedReport],
) -> None:
    """Swap the served pipeline state (callback for the ingestion service)."""
    state["credible"] = credible
    state["incidents"] = _apply_dispatch_state(incidents)
    state["debunked"] = debunked


def run_pipeline(reports: list[RawReport]) -> PipelineResult:
    """Credibility filter first, then geo-clustering of the credible remainder."""
    credible, debunked = filter_reports(reports)
    incidents = _apply_dispatch_state(cluster_reports(credible))
    return {"incidents": incidents, "debunked": debunked}


def submit_report(submission: ReportSubmission) -> SubmissionResult:
    """Push one freshly submitted report through the full pipeline and update state."""
    state["live_seq"] += 1
    report = RawReport(
        id=f"RPT-LIVE-{state['live_seq']:03d}",
        source=submission.source,
        author=submission.author,
        text=submission.text,
        event_type=submission.event_type,
        lat=submission.lat,
        lon=submission.lon,
        timestamp=submission.timestamp or datetime.now(timezone.utc),
        exif_timestamp=submission.exif_timestamp,
        exif_lat=submission.exif_lat,
        exif_lon=submission.exif_lon,
        media_url=submission.media_url,
    )

    assessment = assess_report(report)
    report = annotate_report(report, assessment)
    if not assessment.credible:
        debunked = DebunkedReport(
            id=report.id,
            source=report.source,
            author=report.author,
            text=report.text,
            event_type=report.event_type,
            lat=report.lat,
            lon=report.lon,
            timestamp=report.timestamp,
            reason_flagged=assessment.reason or "Failed credibility checks",
            credibility_score=assessment.score,
            rationale=report.ai_rationale,
            media_consistency=report.ai_media_note,
            media_preview=assessment.analyzed_media or report.first_media_preview(),
        )
        state["debunked"].insert(0, debunked)  # newest first
        if ingestion_service is not None:
            ingestion_service.persist_manual(report, assessment)
        return SubmissionResult(
            verdict="debunked",
            report_id=report.id,
            reason_flagged=debunked.reason_flagged,
            message=f"Debunked by AI filter — {debunked.reason_flagged}",
        )

    if ingestion_service is not None:
        ingestion_service.persist_manual(report, assessment)
    state["credible"].append(report)
    state["incidents"] = _apply_dispatch_state(cluster_reports(state["credible"]))
    incident = next((i for i in state["incidents"] if report.id in i.source_ids), None)
    if incident is None:  # defensive: a credible report always lands in a cluster
        return SubmissionResult(
            verdict="verified", report_id=report.id, message="Verified."
        )

    pct = round(incident.confidence_score * 100)
    if incident.report_count > 1:
        message = (
            f"Verified — merged into {incident.id} "
            f"({incident.report_count} sources, {pct}% confidence)"
        )
    else:
        message = f"Verified — new incident {incident.id} created ({pct}% confidence)"
    return SubmissionResult(
        verdict="verified",
        report_id=report.id,
        incident_id=incident.id,
        confidence_score=incident.confidence_score,
        message=message,
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global ingestion_service, _ingest_task, _geocoder, _geo_client
    settings = IngestionSettings.from_env()

    # Shared geocoder for the /api/geocode endpoint.
    store = FeedStore(settings.db_path)
    await asyncio.to_thread(store.init)
    _geocoder = Geocoder(settings, store)
    _geo_client = httpx.AsyncClient(
        headers={"User-Agent": settings.user_agent},
        timeout=settings.request_timeout_s,
        follow_redirects=True,
    )

    # Real OSINT only: the ingestion service is always the source of served data.
    ingestion_service = IngestionService(
        settings, default_connectors(settings), publish=_publish_snapshot
    )
    await ingestion_service.startup()  # persisted snapshot served instantly
    _ingest_task = asyncio.create_task(ingestion_service.run())
    yield
    if _ingest_task is not None:
        _ingest_task.cancel()
        with suppress(asyncio.CancelledError):
            await _ingest_task
        _ingest_task = None
    if ingestion_service is not None:
        await ingestion_service.aclose()
        ingestion_service = None
    if _geo_client is not None:
        await _geo_client.aclose()
        _geo_client = None


app = FastAPI(
    title="VOSTbw OSINT Dashboard API",
    description="Automated OSINT verification for VOST Baden-Württemberg — Konstanz demo.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/incidents", response_model=list[VerifiedIncident])
def get_incidents() -> list[VerifiedIncident]:
    """Verified, geo-clustered incidents for the live map."""
    return state["incidents"]


@app.get("/api/debunked", response_model=list[DebunkedReport])
def get_debunked() -> list[DebunkedReport]:
    """Reports rejected by the credibility filter ('Disinformation Caught')."""
    return state["debunked"]


@app.post("/api/reports", response_model=SubmissionResult)
def post_report(submission: ReportSubmission) -> SubmissionResult:
    """Inject a live report (demo) and run it through the full pipeline."""
    return submit_report(submission)


@app.post("/api/incidents/{incident_id}/dispatch", response_model=VerifiedIncident)
def dispatch_incident(incident_id: str) -> VerifiedIncident:
    """Manual handoff to the Leitstelle: mark the incident dispatched,
    complete its SOP checklist and print the dispatch payload to the
    operations console (simulating the control-centre interface)."""
    for index, incident in enumerate(state["incidents"]):
        if incident.id != incident_id:
            continue
        stamp = incident.dispatched_at or datetime.now(timezone.utc)
        updated = incident.model_copy(
            update={
                "dispatched": True,
                "dispatched_at": stamp,
                "sop_tasks": [
                    task.model_copy(update={"completed": True})
                    for task in incident.sop_tasks
                ],
            }
        )
        state["incidents"][index] = updated
        record = _DispatchRecord(
            at=stamp, completed_tasks=tuple(task.task for task in updated.sop_tasks)
        )
        _dispatch_registry[incident_id] = record
        _persist_dispatch(incident_id, record)  # survive rebuild / restart (live)
        _print_dispatch_payload(updated)
        return updated
    raise HTTPException(status_code=404, detail=f"Unknown incident: {incident_id}")


@app.post("/api/reset")
async def post_reset() -> dict[str, str | int]:
    """Wipe the live store and re-poll the real feeds from scratch."""
    if ingestion_service is None:
        raise HTTPException(status_code=503, detail="Ingestion not started yet.")
    _dispatch_registry.clear()
    await ingestion_service.reset()
    return {
        "status": "reset",
        "incidents": len(state["incidents"]),
        "debunked": len(state["debunked"]),
    }


@app.post("/api/poll")
async def post_poll() -> dict[str, object]:
    """Trigger one live ingest cycle on demand."""
    if ingestion_service is None:
        raise HTTPException(status_code=503, detail="Ingestion not started yet.")
    stats = await ingestion_service.poll_once()
    return {"status": "polled", "stats": stats}


@app.get("/api/health")
def health() -> dict[str, object]:
    """Liveness + pipeline stats. `ai_mode`: mock / live-ready / live;
    `data_mode`: live once real-feed ingestion has started."""
    payload: dict[str, object] = {
        "status": "ok",
        "incidents": len(state["incidents"]),
        "debunked": len(state["debunked"]),
        "ai_mode": ai_mode(),
        "data_mode": "live" if ingestion_service is not None else "starting",
        **budget_status(),
    }
    if ingestion_service is not None:
        payload["feeds"] = ingestion_service.status()
    return payload


@app.get("/api/ingestion/inbox")
def ingestion_inbox(disposition: str | None = None, limit: int = 200) -> dict[str, object]:
    """Observability: every recently received item and how the pipeline
    disposed of it (verified / debunked / duplicate / stale / not_crisis /
    unlocated / off_sector) — i.e. what came in but isn't on the map and why.
    Filter to one bucket with `?disposition=unlocated`. The window is in-memory
    and only fills with NEW items, so `POST /api/reset` first for a full trace."""
    if ingestion_service is None:
        raise HTTPException(status_code=503, detail="Ingestion not started yet.")
    return ingestion_service.inbox(disposition=disposition, limit=limit)


@app.get("/api/geocode")
async def get_geocode(q: str) -> dict[str, object]:
    """Resolve a place name to coordinates (gazetteer + Nominatim)."""
    if _geocoder is None or _geo_client is None:
        return {"error": "Geocoder not initialized"}

    # Geocoder.resolve(client, place_hint, text, bounded)
    coords = await _geocoder.resolve(_geo_client, q, "", bounded=False)
    if coords:
        return {"lat": coords[0], "lon": coords[1]}
    return {"error": "Location not found"}


# --- Live situational status tiles ------------------------------------------
# Header tiles giving real-time context for the focused location from official
# open APIs. Defaults to the Konstanz sector when no location is provided. Each
# is best-effort: any upstream/network failure degrades to active=false rather
# than erroring, so a tile never breaks the dashboard.


@app.get("/api/dwd/status", response_model=DwdStatus)
async def get_dwd_status(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
) -> DwdStatus:
    """Most severe active DWD weather warning + current temperature for a
    location, via Bright Sky (official DWD open data). Falls back to scanning
    ingested DWD/NINA reports near the location when the alerts API is quiet."""
    loc_lat = lat if lat is not None else SECTOR_DEFAULT_LAT
    loc_lon = lon if lon is not None else SECTOR_DEFAULT_LON

    temperature: float | None = None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(
                f"https://api.brightsky.dev/current_weather?lat={loc_lat}&lon={loc_lon}"
            )
            if res.status_code == 200:
                temperature = res.json().get("weather", {}).get("temperature")
    except Exception:  # noqa: BLE001 - best-effort tile
        pass

    live_alerts: list[dict[str, object]] = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(
                f"https://api.brightsky.dev/alerts?lat={loc_lat}&lon={loc_lon}"
            )
            if res.status_code == 200:
                live_alerts = res.json().get("alerts") or []
    except Exception:  # noqa: BLE001
        pass

    severity_map: dict[str, int] = {
        "minor": 1,
        "moderate": 2,
        "severe": 3,
        "extreme": 4,
    }

    if live_alerts:
        def alert_key(alert: dict[str, object]) -> tuple[int, str]:
            sev = severity_map.get(str(alert.get("severity", "")).lower(), 0)
            return sev, str(alert.get("onset", ""))

        best = sorted(live_alerts, key=alert_key, reverse=True)[0]
        headline = (
            best.get("headline_de")
            or best.get("headline_en")
            or "Amtliche Warnung"
        )
        description = best.get("description_de") or best.get("description_en") or ""
        timestamp = _parse_iso(best.get("onset") or best.get("effective"))
        return DwdStatus(
            active=True,
            level=severity_map.get(str(best.get("severity", "")).lower(), 0),
            headline=str(headline)[:100],
            description=str(description),
            timestamp=timestamp,
            url=(
                "https://www.dwd.de/DE/wetter/warnungen_gemeinden/"
                f"warnWetter_node.html?ort={q or 'Konstanz'}"
            ),
            temperature=temperature,
        )

    # Fallback: scan ingested DWD-sourced reports near the location.
    import re

    from geopy.distance import geodesic

    def warning_level(text: str) -> int:
        match = re.search(r"(?:stufe|level)\s*(\d+)", text.lower())
        return int(match.group(1)) if match else 0

    dwd_reports: list[RawReport] = []
    for report in state["credible"]:
        is_dwd = (
            report.source == "dwd"
            or (report.source == "nina" and report.author == "DWD")
            or "dwd" in report.author.lower()
        )
        if not is_dwd:
            continue
        if geodesic((loc_lat, loc_lon), (report.lat, report.lon)).kilometers > 30.0:
            continue
        dwd_reports.append(report)

    if not dwd_reports:
        return DwdStatus(active=False, temperature=temperature)

    best_report = sorted(
        dwd_reports,
        key=lambda r: (warning_level(r.text), r.timestamp or datetime.min),
        reverse=True,
    )[0]
    return DwdStatus(
        active=True,
        level=warning_level(best_report.text),
        headline=best_report.text.split(":")[0][:100],
        description=best_report.text,
        timestamp=best_report.timestamp,
        url=(
            "https://www.dwd.de/DE/wetter/warnungen_gemeinden/"
            f"warnWetter_node.html?ort={q or 'Konstanz'}"
        ),
        temperature=temperature,
    )


@app.get("/api/pegel/status", response_model=PegelStatus)
async def get_pegel_status(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
) -> PegelStatus:
    """Nearest water-level station and its current reading from PEGELONLINE
    (WSV official open data), expanding the search radius until one is found."""
    loc_lat = lat if lat is not None else SECTOR_DEFAULT_LAT
    loc_lon = lon if lon is not None else SECTOR_DEFAULT_LON

    stations: list[dict[str, object]] = []
    for radius in (30, 50, 100):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(
                    "https://www.pegelonline.wsv.de/webservices/rest-api/v2/"
                    f"stations.json?latitude={loc_lat}&longitude={loc_lon}"
                    f"&radius={radius}&includeTimeseries=true"
                    "&includeCurrentMeasurement=true"
                )
                if res.status_code == 200:
                    stations = res.json()
                    if stations:
                        break
        except Exception:  # noqa: BLE001
            pass

    if not stations:
        return PegelStatus(active=False)

    from geopy.distance import geodesic

    best_station: dict[str, object] | None = None
    best_ts: dict[str, object] | None = None
    best_dist = float("inf")
    for station in stations:
        st_lat = station.get("latitude")
        st_lon = station.get("longitude")
        if st_lat is None or st_lon is None:
            continue
        w_ts = next(
            (
                ts
                for ts in (station.get("timeseries") or [])
                if ts.get("shortname") == "W" and ts.get("currentMeasurement")
            ),
            None,
        )
        if not w_ts:
            continue
        dist = geodesic((loc_lat, loc_lon), (st_lat, st_lon)).kilometers
        if dist < best_dist:
            best_dist, best_station, best_ts = dist, station, w_ts

    if not best_station or not best_ts:
        return PegelStatus(active=False)

    curr = best_ts["currentMeasurement"]
    state_raw = str(curr.get("stateMnwMhw") or "normal").lower()
    if state_raw in ("low", "niedrigwasser", "mnw"):
        state_display = "Niedrigwasser"
    elif state_raw in ("high", "hochwasser", "mhw", "above_mhw"):
        state_display = "Hochwasser"
    else:
        state_display = "Normal"

    water = best_station.get("water") or {}
    water_name = water.get("longname") or water.get("shortname") or "—"
    return PegelStatus(
        active=True,
        station=best_station.get("shortname"),
        water=water_name,
        value=curr.get("value"),
        unit=best_ts.get("unit") or "cm",
        timestamp=_parse_iso(curr.get("timestamp")),
        state=state_display,
        url=(
            "https://www.pegelonline.wsv.de/gast/pegelinformationen?"
            f"gewaesser={str(water_name).upper()}"
        ),
    )


_MOBIDATA_ROADWORKS_URL: str = (
    "https://api.mobidata-bw.de/datasets/traffic/roadworks/roadworks_geojson.json"
)


@app.get("/api/mobidata/status", response_model=MobiDataStatus)
async def get_mobidata_status(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
) -> MobiDataStatus:
    """Closures / heavy-traffic roadworks within 30 km of a location from
    MobiData BW open data; reports the count and the closest one."""
    loc_lat = lat if lat is not None else SECTOR_DEFAULT_LAT
    loc_lon = lon if lon is not None else SECTOR_DEFAULT_LON

    geojson: dict[str, object] = {}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(_MOBIDATA_ROADWORKS_URL)
            if res.status_code == 200:
                geojson = res.json()
    except Exception:  # noqa: BLE001
        pass

    features = geojson.get("features") if isinstance(geojson, dict) else None
    if not features:
        return MobiDataStatus(active=False)

    from geopy.distance import geodesic

    def relevant(feature: dict[str, object]) -> bool:
        props = feature.get("properties") or {}
        text = " ".join(
            str(props.get(k) or "")
            for k in (
                "id", "type", "description", "text", "reason",
                "constructionReason", "location", "place",
            )
        ).lower()
        blocked = any(w in text for w in ("sperr", "block", "closed", "gesperrt"))
        heavy = any(
            w in text
            for w in ("stau", "delay", "congestion", "verzöger", "zähflüss", "überlast")
        )
        return blocked or heavy

    def first_coords(geom: dict[str, object] | None) -> tuple[float, float] | None:
        if not isinstance(geom, dict):
            return None
        gtype, coords = geom.get("type"), geom.get("coordinates")
        try:
            if gtype == "Point" and coords:
                return float(coords[1]), float(coords[0])
            if gtype == "LineString" and coords:
                return float(coords[0][1]), float(coords[0][0])
            if gtype == "Polygon" and coords and coords[0]:
                return float(coords[0][0][1]), float(coords[0][0][0])
        except (ValueError, TypeError, IndexError):
            return None
        return None

    nearby = 0
    closest: dict[str, object] | None = None
    closest_dist = float("inf")
    for feature in features:
        if not isinstance(feature, dict) or not relevant(feature):
            continue
        coords = first_coords(feature.get("geometry"))
        if coords is None:
            continue
        dist = geodesic((loc_lat, loc_lon), coords).kilometers
        if dist <= 30.0:
            nearby += 1
            if dist < closest_dist:
                closest_dist, closest = dist, feature

    if closest is None:
        return MobiDataStatus(active=False, count=0)

    props = closest.get("properties") or {}
    road = props.get("road") or props.get("roadNumber") or props.get("street") or ""
    place = props.get("location") or props.get("place") or props.get("name") or ""
    desc = (
        props.get("description")
        or props.get("text")
        or props.get("reason")
        or props.get("constructionReason")
        or ""
    )
    if not road and not place and not desc:
        desc = "Roadworks / construction warning"

    return MobiDataStatus(
        active=True,
        count=nearby,
        road=str(road)[:50] or None,
        location=str(place)[:100] or None,
        description=str(desc)[:200] or None,
        distance_km=round(closest_dist, 1),
    )


@app.get("/api/mobidata/roadworks")
async def get_mobidata_roadworks() -> dict[str, object]:
    """Raw MobiData BW roadworks GeoJSON (for map overlays)."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(_MOBIDATA_ROADWORKS_URL)
            if res.status_code == 200:
                return res.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "type": "FeatureCollection", "features": []}
    return {"type": "FeatureCollection", "features": []}


def _parse_iso(value: object) -> datetime | None:
    """Parse an ISO-8601 timestamp (tolerating a trailing 'Z'); None on failure."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
