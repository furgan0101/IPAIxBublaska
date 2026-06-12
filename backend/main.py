"""VOSTbw OSINT Situational Awareness API.

Pipeline (runs once at startup):
    mock_data.json --> RawReport models           (ingestion)
                   --> credibility filter         (logic.verification)
                   --> 1 km / 60 min clustering   (logic.geospatial)
                   --> /api/incidents + /api/debunked

Mock timestamps are rebased to "now" at startup so the dashboard always reads
"x minutes ago" in a live demo, while every relative delta (e.g. the stale
EXIF gap on recycled footage) is preserved.
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, TypedDict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from logic.geospatial import cluster_reports
from logic.verification import LIVE_AI_READY, filter_reports
from schemas import DebunkedReport, RawReport, VerifiedIncident

DATA_FILE: Path = Path(__file__).parent / "mock_data.json"

# Local Next.js dev server origins (CORS).
ALLOWED_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


class PipelineResult(TypedDict):
    incidents: list[VerifiedIncident]
    debunked: list[DebunkedReport]


pipeline_store: PipelineResult = {"incidents": [], "debunked": []}


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


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    reports = rebase_timestamps(load_raw_reports(), now=datetime.now(timezone.utc))
    result = run_pipeline(reports)
    pipeline_store["incidents"] = result["incidents"]
    pipeline_store["debunked"] = result["debunked"]
    yield


app = FastAPI(
    title="VOSTbw OSINT Dashboard API",
    description="Automated OSINT verification for VOST Baden-Württemberg — Konstanz demo.",
    version="0.1.0",
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
    return pipeline_store["incidents"]


@app.get("/api/debunked", response_model=list[DebunkedReport])
def get_debunked() -> list[DebunkedReport]:
    """Reports rejected by the credibility filter ('Disinformation Caught')."""
    return pipeline_store["debunked"]


@app.get("/api/health")
def health() -> dict[str, str | int]:
    """Liveness + pipeline stats; `ai_mode` flips once an API key is dropped in."""
    return {
        "status": "ok",
        "incidents": len(pipeline_store["incidents"]),
        "debunked": len(pipeline_store["debunked"]),
        "ai_mode": "live-ready" if LIVE_AI_READY else "mock",
    }
