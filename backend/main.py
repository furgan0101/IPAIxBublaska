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
    MobiDataStatus,
    PegelStatus,
    RawReport,
    ReportSubmission,
    SubmissionResult,
    VerifiedIncident,
    SourceReport,
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
dynamic_incidents: list[VerifiedIncident] = []

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


ARS_MAPPING: dict[str, str] = {
    "heilbronn": "081210000000",
    "konstanz": "083350000000",
    "stuttgart": "081110000000",
    "karlsruhe": "082120000000",
    "heidelberg": "082210000000",
    "freiburg": "083110000000",
    "ulm": "084210000000",
    "pforzheim": "082310000000",
    "reutlingen": "084150000000",
    "tuebingen": "084160000000",
    "esslingen": "081160000000",
    "ludwigsburg": "081180000000",
    "goeppingen": "081170000000",
    "aalen": "081360000000",
}


async def fetch_dynamic_live_alerts(q: str, lat: float, lon: float) -> list[VerifiedIncident]:
    incidents: list[VerifiedIncident] = []
    
    # 1. DWD Alerts from Bright Sky API
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(f"https://api.brightsky.dev/alerts?lat={lat}&lon={lon}")
            if res.status_code == 200:
                alerts_data = res.json()
                for alert in alerts_data.get("alerts") or []:
                    alert_id = alert.get("id") or str(hash(alert.get("headline", "")))
                    headline = alert.get("headline", "").strip() or alert.get("headline_de", "").strip() or "Amtliche Warnung"
                    desc = alert.get("description", "").strip() or alert.get("description_de", "").strip() or ""
                    
                    sent_str = alert.get("effective_utc") or alert.get("onset_utc") or datetime.now(timezone.utc).isoformat()
                    try:
                        timestamp = datetime.fromisoformat(sent_str.replace("Z", "+00:00"))
                    except Exception:
                        timestamp = datetime.now(timezone.utc)
                    
                    severity_raw = alert.get("severity", "").lower()
                    severity = "moderate"
                    if severity_raw in ("severe", "extreme", "high"):
                        severity = "high"
                    elif severity_raw in ("minor", "low"):
                        severity = "low"
                        
                    inc_id = f"INC-LIVE-DWD-{alert_id}"
                    
                    # Create SourceReport
                    src = SourceReport(
                        id=f"RPT-LIVE-DWD-{alert_id}",
                        source="dwd",
                        author="DWD",
                        text=f"{headline}: {desc}" if desc else headline,
                        timestamp=timestamp,
                        url="https://www.dwd.de",
                        media_preview=None,
                        ai_rationale=f"Official weather warning issued by DWD for {q}.",
                        ai_media_note=None,
                        ai_credibility=1.0
                    )
                    
                    # Create VerifiedIncident
                    incident = VerifiedIncident(
                        id=inc_id,
                        event_type="storm",
                        lat=lat,
                        lon=lon,
                        confidence_score=1.0,
                        ai_credibility=1.0,
                        source_ids=[src.id],
                        report_count=1,
                        first_seen=timestamp,
                        last_seen=timestamp,
                        summary=headline,
                        severity=severity,
                        action_hint="Warn of falling trees and debris; prioritise road-clearance crews on the affected routes.",
                        sources=[src],
                        related_incidents=[]
                    )
                    incidents.append(incident)
    except Exception as e:
        logging.warning("Failed to fetch dynamic DWD alerts: %s", e)

    # 2. NINA warnings matching city query
    q_norm = q.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").strip()
    ars = ARS_MAPPING.get(q_norm)
    if ars:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(f"https://warnung.bund.de/api31/dashboard/{ars}.json")
                if res.status_code == 200:
                    warnings = res.json() or []
                    for idx, entry in enumerate(warnings):
                        warning_id = entry.get("id")
                        if not warning_id:
                            continue
                        payload_data = (entry.get("payload") or {}).get("data") or {}
                        headline = (
                            payload_data.get("headline")
                            or (entry.get("i18nTitle") or {}).get("de")
                            or "Gefahrenmeldung"
                        ).strip()
                        desc = payload_data.get("description", "").strip()
                        provider = str(payload_data.get("provider") or "NINA").upper()
                        
                        sent_str = entry.get("sent") or entry.get("startDate") or datetime.now(timezone.utc).isoformat()
                        try:
                            timestamp = datetime.fromisoformat(sent_str.replace("Z", "+00:00"))
                        except Exception:
                            timestamp = datetime.now(timezone.utc)
                            
                        # Add a small offset to prevent exact pin overlapping
                        offset_lat = lat + (idx * 0.002)
                        offset_lon = lon + (idx * 0.002)
                        
                        inc_id = f"INC-LIVE-NINA-{warning_id}"
                        src = SourceReport(
                            id=f"RPT-LIVE-NINA-{warning_id}",
                            source="nina",
                            author=provider,
                            text=f"{headline}: {desc}" if desc else headline,
                            timestamp=timestamp,
                            url="https://warnung.bund.de/meldungen",
                            media_preview=None,
                            ai_rationale=f"Official NINA warning issued by {provider} for region {q}.",
                            ai_media_note=None,
                            ai_credibility=1.0
                        )
                        
                        incident = VerifiedIncident(
                            id=inc_id,
                            event_type="infrastructure_failure",
                            lat=offset_lat,
                            lon=offset_lon,
                            confidence_score=1.0,
                            ai_credibility=1.0,
                            source_ids=[src.id],
                            report_count=1,
                            first_seen=timestamp,
                            last_seen=timestamp,
                            summary=headline,
                            severity="moderate",
                            action_hint="Identify affected lifeline systems, activate redundancy plans and inform operators' crisis cells.",
                            sources=[src],
                            related_incidents=[]
                        )
                        incidents.append(incident)
        except Exception as e:
            logging.warning("Failed to fetch dynamic NINA warnings: %s", e)

    # 3. PEGELONLINE Water level warning
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(
                f"https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?"
                f"latitude={lat}&longitude={lon}&radius=30"
                f"&includeTimeseries=true&includeCurrentMeasurement=true"
            )
            if res.status_code == 200:
                stations = res.json() or []
                for idx, station in enumerate(stations):
                    # Check if station has timeseries and current measurement for water level 'W'
                    timeseries = station.get("timeseries") or []
                    w_ts = None
                    for ts in timeseries:
                        if ts.get("shortname") == "W" and ts.get("currentMeasurement"):
                            w_ts = ts
                            break
                    if not w_ts:
                        continue
                        
                    curr = w_ts["currentMeasurement"]
                    val = curr.get("value")
                    state_raw = curr.get("stateMnwMhw") or "normal"
                    if state_raw.lower() not in ("low", "niedrigwasser", "mnw", "high", "hochwasser", "mhw", "above_mhw"):
                        continue # Skip normal levels for alert lists
                        
                    # Determine event class & description
                    is_high = state_raw.lower() in ("high", "hochwasser", "mhw", "above_mhw")
                    event_type = "flood" if is_high else "water_supply"
                    state_display = "Hochwasser" if is_high else "Niedrigwasser"
                    
                    station_name = station.get("shortname", "Unknown Station")
                    water_name = station.get("water", {}).get("longname") or "RHEIN"
                    
                    st_lat = station.get("latitude") or lat
                    st_lon = station.get("longitude") or lon
                    
                    headline = f"Water Level Alert ({state_display}): Station {station_name}"
                    desc = f"PEGELONLINE station {station_name} on water body {water_name} reports {state_display} level of {val} {w_ts.get('unit', 'cm')}."
                    
                    sent_str = curr.get("timestamp") or datetime.now(timezone.utc).isoformat()
                    try:
                        timestamp = datetime.fromisoformat(sent_str.replace("Z", "+00:00"))
                    except Exception:
                        timestamp = datetime.now(timezone.utc)
                        
                    inc_id = f"INC-LIVE-PEGEL-{station_name}"
                    src = SourceReport(
                        id=f"RPT-LIVE-PEGEL-{station_name}",
                        source="pegelonline",
                        author="PEGELONLINE",
                        text=desc,
                        timestamp=timestamp,
                        url=f"https://www.pegelonline.wsv.de",
                        media_preview=None,
                        ai_rationale=f"PEGELONLINE sensor alert near {q}.",
                        ai_media_note=None,
                        ai_credibility=1.0
                    )
                    
                    action_hint_text = (
                        "Close affected waterfront paths, deploy pumping crews and monitor the water level gauge."
                        if is_high else
                        "Coordinate emergency water distribution points and issue boil-water advisories where applicable."
                    )
                    
                    incident = VerifiedIncident(
                        id=inc_id,
                        event_type=event_type,
                        lat=st_lat,
                        lon=st_lon,
                        confidence_score=1.0,
                        ai_credibility=1.0,
                        source_ids=[src.id],
                        report_count=1,
                        first_seen=timestamp,
                        last_seen=timestamp,
                        summary=headline,
                        severity="moderate",
                        action_hint=action_hint_text,
                        sources=[src],
                        related_incidents=[]
                    )
                    incidents.append(incident)
    except Exception as e:
        logging.warning("Failed to fetch dynamic PEGELONLINE warnings: %s", e)

    return incidents


def reset_state() -> None:
    """(Re)load the mock feed and rebuild the in-memory pipeline state."""
    now = datetime.now(timezone.utc)
    reports = rebase_timestamps(load_raw_reports(), now=now)
    credible, debunked = filter_reports(reports)
    state["credible"] = credible
    state["debunked"] = debunked
    state["incidents"] = cluster_reports(credible)
    state["live_seq"] = 0
    global live_incidents, dynamic_incidents
    live_incidents = build_live_incidents(now)
    dynamic_incidents = []


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
    return state["incidents"] + live_incidents + dynamic_incidents


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


@app.get("/api/mobidata/status", response_model=MobiDataStatus)
async def get_mobidata_status(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None
) -> MobiDataStatus:
    """Fetch current roadworks, construction, and closure warnings from MobiData BW."""
    temp_lat = lat if lat is not None else 49.534767
    temp_lon = lon if lon is not None else 8.461813

    geojson_data = {}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get("https://api.mobidata-bw.de/datasets/traffic/roadworks/roadworks_geojson.json")
            if res.status_code == 200:
                geojson_data = res.json()
    except Exception:
        pass

    if not geojson_data or not isinstance(geojson_data, dict):
        return MobiDataStatus(active=False)

    features = geojson_data.get("features") or []
    if not features:
        return MobiDataStatus(active=False)

    from geopy.distance import geodesic
    nearby_count = 0
    closest_feature = None
    closest_dist = float("inf")

    def is_blocked_or_heavy_traffic(f):
        if not f or not isinstance(f, dict):
            return False
        props = f.get("properties") or {}
        text = (
            str(props.get("id") or "") + " " +
            str(props.get("type") or "") + " " +
            str(props.get("description") or "") + " " +
            str(props.get("text") or "") + " " +
            str(props.get("reason") or "") + " " +
            str(props.get("constructionReason") or "") + " " +
            str(props.get("location") or "") + " " +
            str(props.get("place") or "")
        ).lower()
        
        blocked = any(w in text for w in ("sperr", "block", "closed", "gesperrt"))
        heavy = any(w in text for w in ("stau", "delay", "congestion", "verzöger", "zähflüss", "überlast"))
        return blocked or heavy

    def get_first_coords(geom):
        if not geom or not isinstance(geom, dict):
            return None
        t = geom.get("type")
        c = geom.get("coordinates")
        if not c:
            return None
        try:
            if t == "Point":
                return float(c[1]), float(c[0])
            elif t == "LineString" and len(c) > 0:
                return float(c[0][1]), float(c[0][0])
            elif t == "Polygon" and len(c) > 0 and len(c[0]) > 0:
                return float(c[0][0][1]), float(c[0][0][0])
        except (ValueError, TypeError, IndexError):
            pass
        return None

    for f in features:
        if not isinstance(f, dict):
            continue
        if not is_blocked_or_heavy_traffic(f):
            continue
        geom = f.get("geometry")
        coords = get_first_coords(geom)
        if not coords:
            continue

        dist = geodesic((temp_lat, temp_lon), coords).kilometers
        if dist <= 30.0:
            nearby_count += 1
            if dist < closest_dist:
                closest_dist = dist
                closest_feature = f

    if not closest_feature:
        return MobiDataStatus(active=False, count=0)

    props = closest_feature.get("properties") or {}
    road = props.get("road") or props.get("roadNumber") or props.get("street") or ""
    loc = props.get("location") or props.get("place") or props.get("name") or ""
    desc = props.get("description") or props.get("text") or props.get("reason") or props.get("constructionReason") or ""

    if not road and not loc and not desc:
        desc = "Roadworks / construction warning"

    url = "https://www.verkehrsinfo-bw.de"

    return MobiDataStatus(
        active=True,
        count=nearby_count,
        road=str(road)[:50] if road else None,
        location=str(loc)[:100] if loc else None,
        description=str(desc)[:200] if desc else None,
        distance_km=round(closest_dist, 1),
        url=url
    )


@app.get("/api/mobidata/roadworks")
async def get_mobidata_roadworks() -> dict[str, object]:
    """Fetch the raw roadworks GeoJSON from MobiData BW."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get("https://api.mobidata-bw.de/datasets/traffic/roadworks/roadworks_geojson.json")
            if res.status_code == 200:
                return res.json()
    except Exception as e:
        return {"error": str(e), "type": "FeatureCollection", "features": []}
    return {"type": "FeatureCollection", "features": []}


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
    global dynamic_incidents
    dynamic_incidents = []
    return {
        "status": "reset",
        "incidents": len(state["incidents"]),
        "debunked": len(state["debunked"]),
    }


@app.post("/api/poll")
async def post_poll(
    q: str | None = None,
    lat: float | None = None,
    lon: float | None = None
) -> dict[str, object]:
    """Trigger one live ingest cycle on demand (live mode only)."""
    global dynamic_incidents
    
    if q and q.strip().lower() == "mannheim":
        dynamic_incidents = []
        return {
            "status": "polled-mannheim",
            "detail": "Mannheim uses mock-only data. Cleared dynamic incidents.",
            "stats": {"new_verified": 0}
        }
        
    if lat is not None and lon is not None:
        fetched = await fetch_dynamic_live_alerts(q or "Search Location", lat, lon)
        dynamic_incidents = fetched
        return {
            "status": "polled-dynamic",
            "count": len(fetched),
            "stats": {"new_verified": len(fetched)}
        }
        
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
