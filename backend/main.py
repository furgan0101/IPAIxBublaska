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

from ingestion import IngestionService, IngestionSettings, default_connectors
from logic.geospatial import cluster_reports
from logic.verification import ai_mode, apply_event_type, assess_report, filter_reports
from schemas import (
    DebunkedReport,
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
    "null",  # file:// origin for debug.html opened directly in the browser
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

# Live ingestion (FEEDS_ENABLED=true): created during lifespan, None in mock mode.
ingestion_service: IngestionService | None = None
_ingest_task: asyncio.Task[None] | None = None


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
    reports = rebase_timestamps(load_raw_reports(), now=datetime.now(timezone.utc))
    credible, debunked = filter_reports(reports)
    state["credible"] = credible
    state["debunked"] = debunked
    state["incidents"] = cluster_reports(credible)
    state["live_seq"] = 0


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

    verified = apply_event_type(report, assessment)
    if ingestion_service is not None:
        ingestion_service.persist_manual(verified, assessment)
    state["credible"].append(verified)
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
    global ingestion_service, _ingest_task
    settings = IngestionSettings.from_env()
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
        "incidents": len(state["incidents"]),
        "debunked": len(state["debunked"]),
        "ai_mode": ai_mode(),
        "data_mode": "live" if ingestion_service is not None else "mock",
    }
    if ingestion_service is not None:
        payload["feeds"] = ingestion_service.status()
    return payload
