"""VOSTbw OSINT Situational Awareness API.

Pipeline (runs at startup, and again per live injection):
    mock_data.json --> RawReport models           (ingestion)
                   --> credibility filter         (logic.verification)
                   --> 1 km / 60 min clustering   (logic.geospatial)
                   --> /api/incidents + /api/debunked

Live demo:
    POST /api/reports  -> push one report through the pipeline, update state
    POST /api/reset    -> restore the initial state (mock reload / live re-poll)

Real data (FEEDS_ENABLED=true in backend/.env):
    ingestion.IngestionService polls keyless open sources (NINA warnings,
    Presseportal police RSS, Mastodon hashtags), runs every new report through
    the same credibility filter + clustering, and publishes the snapshot
    served below. POST /api/poll triggers a cycle on demand. Without the flag
    the synthetic mock feed is served exactly as before (offline default).

Mock timestamps are rebased to "now" at startup so the dashboard always reads
"x minutes ago" in a live demo, while every relative delta (e.g. the stale
EXIF gap on recycled footage) is preserved.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, TypedDict

from fastapi import FastAPI
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
from live_incident import build_live_incidents
from logic.geospatial import cluster_reports
from logic.verification import (
    ai_mode,
    annotate_report,
    assess_report,
    budget_status,
    filter_reports,
)
from schemas import (
    DebunkedReport,
    DwdStatus,
    PegelStatus,
    RawReport,
    ReportSubmission,
    SubmissionResult,
    VerifiedIncident,
)

DATA_FILE: Path = Path(__file__).parent / "mock_data.json"

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

# The Mannheim-Rheinau industrial-fire scenario (data/live.json), built once at
# reset and served additively alongside the synthetic mock incidents. Kept in
# its own list so live report injection (which re-clusters `state`) never wipes
# it, and so the mock-only pipeline tests can inspect `state` in isolation.
live_incidents: list[VerifiedIncident] = []

# Live ingestion (FEEDS_ENABLED=true): created during lifespan, None in mock mode.
ingestion_service: IngestionService | None = None
_ingest_task: asyncio.Task[None] | None = None

# Geocoder is always available (uses local gazetteer + optional Nominatim).
_geocoder: Geocoder | None = None
_geo_client: httpx.AsyncClient | None = None


def _publish_snapshot(
    credible: list[RawReport],
    incidents: list[VerifiedIncident],
    debunked: list[DebunkedReport],
) -> None:
    """Swap the served pipeline state (callback for the ingestion service)."""
    state["credible"] = credible
    state["incidents"] = incidents
    state["debunked"] = debunked


def load_raw_reports(path: Path = DATA_FILE) -> list[RawReport]:
    """Ingestion step: parse the (mock) feed into validated RawReport models."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [RawReport.model_validate(item) for item in payload["reports"]]


def rebase_timestamps(reports: list[RawReport], now: datetime) -> list[RawReport]:
    """Shift all timestamps so the newest post == `now` (deltas preserved)."""
    newest = max(r.timestamp for r in reports)
    shift = now - newest
    rebased: list[RawReport] = []
    for report in reports:
        update: dict[str, datetime] = {"timestamp": report.timestamp + shift}
        if report.exif_timestamp is not None:
            update["exif_timestamp"] = report.exif_timestamp + shift
        rebased.append(report.model_copy(update=update))
    return rebased


def run_pipeline(reports: list[RawReport]) -> PipelineResult:
    """Credibility filter first, then geo-clustering of the credible remainder."""
    credible, debunked = filter_reports(reports)
    incidents = cluster_reports(credible)
    return {"incidents": incidents, "debunked": debunked}


def reset_state() -> None:
    """(Re)load the mock feed and rebuild the in-memory pipeline state."""
    now = datetime.now(timezone.utc)
    reports = rebase_timestamps(load_raw_reports(), now=now)
    credible, debunked = filter_reports(reports)
    state["credible"] = credible
    state["debunked"] = debunked
    state["incidents"] = cluster_reports(credible)
    state["live_seq"] = 0
    global live_incidents
    live_incidents = build_live_incidents(now)


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
    state["incidents"] = cluster_reports(state["credible"])
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

    if settings.enabled:
        ingestion_service = IngestionService(
            settings, default_connectors(settings), publish=_publish_snapshot
        )
        await ingestion_service.startup()  # persisted snapshot served instantly
        _ingest_task = asyncio.create_task(ingestion_service.run())
    else:
        reset_state()
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
    """Verified, geo-clustered incidents for the live map (mock-feed clusters
    plus the Mannheim-Rheinau live.json scenario)."""
    return state["incidents"] + live_incidents


@app.get("/api/dwd/status", response_model=DwdStatus)
async def get_dwd_status(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None
) -> DwdStatus:
    """Scan active reports for the most severe DWD warning, optionally filtered by location."""
    # Fetch current temperature from Bright Sky
    temperature: float | None = None
    temp_lat = lat if lat is not None else 49.534767
    temp_lon = lon if lon is not None else 8.461813
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"https://api.brightsky.dev/current_weather?lat={temp_lat}&lon={temp_lon}")
            if res.status_code == 200:
                temp_data = res.json()
                temperature = temp_data.get("weather", {}).get("temperature")
    except Exception:
        pass

    # Fetch live alerts from Bright Sky alerts API directly
    live_alerts = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"https://api.brightsky.dev/alerts?lat={temp_lat}&lon={temp_lon}")
            if res.status_code == 200:
                alerts_data = res.json()
                live_alerts = alerts_data.get("alerts") or []
    except Exception:
        pass

    if live_alerts:
        severity_map = {"minor": 1, "moderate": 2, "severe": 3, "extreme": 4}
        
        def alert_key(alert):
            sev = severity_map.get(alert.get("severity", "").lower(), 0)
            onset = alert.get("onset", "")
            return (sev, onset)
            
        best_alert = sorted(live_alerts, key=alert_key, reverse=True)[0]
        headline = best_alert.get("headline_de") or best_alert.get("headline_en") or "Amtliche Warnung"
        description = best_alert.get("description_de") or best_alert.get("description_en") or ""
        timestamp_str = best_alert.get("onset") or best_alert.get("effective")
        timestamp = None
        if timestamp_str:
            try:
                from datetime import datetime
                if timestamp_str.endswith("Z"):
                    timestamp_str = timestamp_str[:-1] + "+00:00"
                timestamp = datetime.fromisoformat(timestamp_str)
            except Exception:
                pass
                
        return DwdStatus(
            active=True,
            level=severity_map.get(best_alert.get("severity", "").lower(), 0),
            headline=headline[:100],
            description=description,
            timestamp=timestamp,
            url=f"https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html?ort={q or 'Mannheim'}",
            temperature=temperature
        )

    # Fallback to local active reports scanning
    # Look in credible reports and live incidents
    all_reports: list[tuple[Any, float, float]] = []
    for r in state["credible"]:
        all_reports.append((r, r.lat, r.lon))
    for inc in live_incidents:
        for src in inc.sources:
            all_reports.append((src, inc.lat, inc.lon))

    dwd_reports = []
    for r, r_lat, r_lon in all_reports:
        is_dwd = (
            r.source == "dwd"
            or (r.source == "nina" and r.author == "DWD")
            or "dwd" in r.author.lower()
        )
        if not is_dwd:
            continue

        matched = True
        if (lat is not None and lon is not None) or q:
            matched_by_dist = False
            matched_by_name = False

            if lat is not None and lon is not None:
                from geopy.distance import geodesic
                dist = geodesic((lat, lon), (r_lat, r_lon)).kilometers
                if dist <= 30.0:
                    matched_by_dist = True

            if q:
                q_clean = q.strip().lower()
                if q_clean in r.text.lower() or q_clean in getattr(r, "author", "").lower():
                    matched_by_name = True

            matched = matched_by_dist or matched_by_name

        if not matched:
            continue

        dwd_reports.append((r, r_lat, r_lon))

    if not dwd_reports:
        return DwdStatus(active=False, temperature=temperature)

    # Sort by severity (Stufe/Level X in text) then by timestamp
    def warning_level(text: str) -> int:
        import re
        match = re.search(r"(?:stufe|level)\s*(\d+)", text.lower())
        return int(match.group(1)) if match else 0

    # Pick the one with highest level, then newest
    best_item = sorted(
        dwd_reports,
        key=lambda item: (warning_level(item[0].text), item[0].timestamp),
        reverse=True
    )[0]
    best = best_item[0]

    return DwdStatus(
        active=True,
        level=warning_level(best.text),
        headline=best.text.split(":")[0][:100],
        description=best.text,
        timestamp=best.timestamp,
        url=f"https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html?ort={q or 'Mannheim'}",
        temperature=temperature
    )


@app.get("/api/pegel/status", response_model=PegelStatus)
async def get_pegel_status(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None
) -> PegelStatus:
    """Get the nearest water level (pegel) station information from PEGELONLINE."""
    temp_lat = lat if lat is not None else 49.534767
    temp_lon = lon if lon is not None else 8.461813

    stations = []
    for radius in [30, 50, 100]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(
                    f"https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?"
                    f"latitude={temp_lat}&longitude={temp_lon}&radius={radius}"
                    f"&includeTimeseries=true&includeCurrentMeasurement=true"
                )
                if res.status_code == 200:
                    stations = res.json()
                    if stations:
                        break
        except Exception:
            pass

    if not stations:
        return PegelStatus(active=False)

    from geopy.distance import geodesic
    best_station = None
    best_dist = float("inf")
    best_w_timeseries = None

    for station in stations:
        st_lat = station.get("latitude")
        st_lon = station.get("longitude")
        if st_lat is None or st_lon is None:
            continue
        
        timeseries_list = station.get("timeseries") or []
        w_ts = None
        for ts in timeseries_list:
            if ts.get("shortname") == "W" and ts.get("currentMeasurement"):
                w_ts = ts
                break
        
        if not w_ts:
            continue

        dist = geodesic((temp_lat, temp_lon), (st_lat, st_lon)).kilometers
        if dist < best_dist:
            best_dist = dist
            best_station = station
            best_w_timeseries = w_ts

    if not best_station or not best_w_timeseries:
        return PegelStatus(active=False)

    curr = best_w_timeseries["currentMeasurement"]
    val = curr.get("value")
    timestamp_str = curr.get("timestamp")
    timestamp = None
    if timestamp_str:
        try:
            if timestamp_str.endswith("Z"):
                timestamp_str = timestamp_str[:-1] + "+00:00"
            timestamp = datetime.fromisoformat(timestamp_str)
        except Exception:
            pass

    state_raw = curr.get("stateMnwMhw") or "normal"
    state_display = "Normal"
    if state_raw.lower() in ("low", "niedrigwasser", "mnw"):
        state_display = "Niedrigwasser"
    elif state_raw.lower() in ("high", "hochwasser", "mhw", "above_mhw"):
        state_display = "Hochwasser"

    station_name = best_station.get("shortname")
    water_name = best_station.get("water", {}).get("longname") or best_station.get("water", {}).get("shortname") or "RHEIN"
    
    url = f"https://www.pegelonline.wsv.de/gast/pegelinformationen?scrollPosition=0&gewaesser={water_name.upper()}"

    return PegelStatus(
        active=True,
        station=station_name,
        water=water_name,
        value=val,
        unit=best_w_timeseries.get("unit") or "cm",
        timestamp=timestamp,
        state=state_display,
        url=url
    )


@app.get("/api/debunked", response_model=list[DebunkedReport])
def get_debunked() -> list[DebunkedReport]:
    """Reports rejected by the credibility filter ('Disinformation Caught')."""
    return state["debunked"]


@app.post("/api/reports", response_model=SubmissionResult)
def post_report(submission: ReportSubmission) -> SubmissionResult:
    """Inject a live report (demo) and run it through the full pipeline."""
    return submit_report(submission)


@app.post("/api/reset")
async def post_reset() -> dict[str, str | int]:
    """Restore the initial state: mock feed reload, or live wipe + re-poll."""
    if ingestion_service is not None:
        await ingestion_service.reset()
    else:
        reset_state()
    return {
        "status": "reset",
        "incidents": len(state["incidents"]),
        "debunked": len(state["debunked"]),
    }


@app.post("/api/poll")
async def post_poll() -> dict[str, object]:
    """Trigger one live ingest cycle on demand (live mode only)."""
    if ingestion_service is None:
        return {
            "status": "mock-mode",
            "detail": "Set FEEDS_ENABLED=true in backend/.env to poll real feeds.",
        }
    stats = await ingestion_service.poll_once()
    return {"status": "polled", "stats": stats}


@app.get("/api/health")
def health() -> dict[str, object]:
    """Liveness + pipeline stats. `ai_mode`: mock / live-ready / live;
    `data_mode`: live when real-feed ingestion is enabled."""
    payload: dict[str, object] = {
        "status": "ok",
        "incidents": len(state["incidents"]) + len(live_incidents),
        "debunked": len(state["debunked"]),
        "ai_mode": ai_mode(),
        "data_mode": "live" if ingestion_service is not None else "mock",
        **budget_status(),
    }
    if ingestion_service is not None:
        payload["feeds"] = ingestion_service.status()
    return payload


@app.get("/api/geocode")
async def get_geocode(q: str) -> dict[str, object]:
    """Resolve a place name to coordinates (gazetteer + Nominatim)."""
    if _geocoder is None or _geo_client is None:
        return {"error": "Geocoder not initialized"}

    # Geocoder.resolve(client, place_hint, text)
    coords = await _geocoder.resolve(_geo_client, q, "")
    if coords:
        return {"lat": coords[0], "lon": coords[1]}
    return {"error": "Location not found"}
