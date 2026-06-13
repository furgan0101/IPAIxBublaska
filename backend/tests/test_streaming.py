"""Real-time streaming tests — recorded fixtures + fakes only, ZERO network.

Covers: stream-frame parsing (Mastodon WS + Bluesky Jetstream), the hard
firehose pre-filter, reconnect/backoff supervision with a fake socket runner,
the throughput cap, and the service-level stream consumer + ring buffer.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from ingestion import streaming
from ingestion.base import FetchedItem
from ingestion.config import IngestionSettings
from ingestion.service import IngestionService
from ingestion.streaming import (
    StreamAuthRejected,
    StreamRateLimiter,
    StreamStatus,
    jetstream_to_item,
    next_backoff,
    parse_mastodon_frame,
    supervise,
)
from logic.verification import Assessment

FIXTURES: Path = Path(__file__).parent / "fixtures"
SECTOR_KEYWORDS: tuple[str, ...] = ("konstanz", "bodensee", "radolfzell")


@pytest.fixture(autouse=True)
def _offline_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "LITELLM_API_KEY",
        "LITELLM_API_KEYS",
        "USE_LIVE_AI",
        "USE_VISION",
        "LLM_MAX_CALLS",
    ):
        monkeypatch.delenv(var, raising=False)


def make_settings(tmp_path: Path, **overrides: Any) -> IngestionSettings:
    base: dict[str, Any] = {
        "enabled": True,
        "poll_interval_s": 120.0,
        "retention_hours": 24.0,
        "sector_lat": 47.6603,
        "sector_lon": 9.1758,
        "sector_radius_km": 40.0,
        "db_path": tmp_path / "feeds.db",
        "nina_regions": ("083350000000",),
        "presseportal_feeds": ("https://feeds.example/pp.rss2",),
        "mastodon_instance": "https://mastodon.example",
        "mastodon_tags": ("konstanz",),
        "nominatim_enabled": False,
        "request_timeout_s": 5.0,
        "user_agent": "VOSTbw-tests",
        "streaming_enabled": False,  # consumer methods are exercised directly
    }
    base.update(overrides)
    return IngestionSettings(**base)


# --- Mastodon frame parsing -------------------------------------------------------------


def test_mastodon_frame_parses_to_fetched_item() -> None:
    frame = json.loads(
        (FIXTURES / "mastodon_stream_frame.json").read_text(encoding="utf-8")
    )
    item = parse_mastodon_frame(frame)
    assert item is not None
    assert item.source == "mastodon"
    assert item.author == "@kn_melder"
    assert "Stromausfall in Petershausen-Ost" in item.text
    assert "<" not in item.text  # HTML stripped
    assert item.source_id == "https://mastodon.example/users/kn_melder/statuses/998877"


def test_mastodon_frame_ignores_non_update_and_garbage() -> None:
    assert parse_mastodon_frame({"event": "delete", "payload": "123"}) is None
    assert parse_mastodon_frame('{"event":"update","payload":"not json"}') is None
    assert parse_mastodon_frame("complete garbage {{{") is None


# --- Jetstream parsing + hard pre-filter ---------------------------------------------------


def test_jetstream_crisis_post_passes_prefilter() -> None:
    event = json.loads(
        (FIXTURES / "jetstream_konstanz.json").read_text(encoding="utf-8")
    )
    item = jetstream_to_item(event, SECTOR_KEYWORDS)
    assert item is not None
    assert item.source == "bluesky"
    assert item.place_hint == "konstanz"
    assert item.url == (
        "https://bsky.app/profile/did:plc:abc123xyz789/post/3kabc123def"
    )
    assert item.media and "cdn.bsky.app" in item.media[0].url
    assert "bafkreigexampleimg1234" in item.media[0].url


def _jetstream_event(**record_overrides: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "$type": "app.bsky.feed.post",
        "createdAt": "2026-06-12T14:00:00.000Z",
        "langs": ["de"],
        "text": "Hochwasser in Konstanz, Uferweg gesperrt",
    }
    record.update(record_overrides)
    return {
        "did": "did:plc:test",
        "kind": "commit",
        "commit": {
            "operation": "create",
            "collection": "app.bsky.feed.post",
            "rkey": "3krkey",
            "record": record,
        },
    }


def test_jetstream_prefilter_drops_irrelevant_posts() -> None:
    # wrong language
    assert (
        jetstream_to_item(_jetstream_event(langs=["fr"]), SECTOR_KEYWORDS) is None
    )
    # no sector keyword
    assert (
        jetstream_to_item(
            _jetstream_event(text="Hochwasser irgendwo in Norddeutschland heute"),
            SECTOR_KEYWORDS,
        )
        is None
    )
    # sector keyword but not crisis-relevant
    assert (
        jetstream_to_item(
            _jetstream_event(text="Schöner Sonnenuntergang am Bodensee heute Abend"),
            SECTOR_KEYWORDS,
        )
        is None
    )
    # delete operations never produce items
    event = _jetstream_event()
    event["commit"]["operation"] = "delete"
    assert jetstream_to_item(event, SECTOR_KEYWORDS) is None


# --- backoff + supervision -------------------------------------------------------------------


def test_wss_from_redirect_swaps_scheme() -> None:
    from ingestion.streaming import wss_from_redirect

    assert (
        wss_from_redirect(
            "https://streaming.mastodon.social/api/v1/streaming isn't a valid URI"
        )
        == "wss://streaming.mastodon.social/api/v1/streaming"
    )
    assert wss_from_redirect("no uri in here") is None


def test_next_backoff_doubles_to_cap() -> None:
    delays = []
    previous: float | None = None
    for _ in range(8):
        previous = next_backoff(previous)
        delays.append(previous)
    assert delays == [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0]


def test_supervise_reconnects_with_backoff_then_stops_on_block() -> None:
    status = StreamStatus(name="test")
    delays: list[float] = []
    attempts = {"n": 0}

    async def fake_sleeper(delay: float) -> None:
        delays.append(delay)

    async def runner() -> None:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ConnectionError("socket dropped")
        raise StreamAuthRejected("HTTP 403")

    asyncio.run(supervise("test", status, runner, sleeper=fake_sleeper))

    assert attempts["n"] == 3
    assert delays == [1.0, 2.0]  # exponential backoff between retries
    assert status.state == "blocked"
    assert "403" in (status.detail or "")


def test_supervise_switches_to_fallback_on_rejection() -> None:
    status = StreamStatus(name="test")
    ran_fallback = {"flag": False}

    async def runner() -> None:
        raise StreamAuthRejected("HTTP 401")

    async def fallback() -> None:
        ran_fallback["flag"] = True

    asyncio.run(supervise("test", status, runner, on_auth_rejected=fallback))

    assert ran_fallback["flag"]
    assert status.state == "fallback-polling"


# --- throughput cap -----------------------------------------------------------------------------


def test_rate_limiter_caps_per_minute_window() -> None:
    limiter = StreamRateLimiter(per_minute=2)
    assert limiter.allow(now=100.0)
    assert limiter.allow(now=101.0)
    assert not limiter.allow(now=102.0)  # third within the window -> deferred
    assert limiter.allow(now=161.5)  # window slid -> allowed again


def test_rate_limiter_zero_means_unlimited() -> None:
    limiter = StreamRateLimiter(per_minute=0)
    assert all(limiter.allow(now=float(n)) for n in range(50))


# --- service consumer + ring buffer -----------------------------------------------------------


def _stream_item(suffix: str, text: str) -> FetchedItem:
    return FetchedItem(
        source="bluesky",
        source_id=f"at://did:plc:test/app.bsky.feed.post/{suffix}",
        author="bsky:test",
        text=text,
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=1),
        lat=47.6603,  # pre-located -> no geocoder involved
        lon=9.1758,
    )


def test_stream_consumer_ingests_and_fills_ring_buffer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "ingestion.service.assess_report",
        lambda report: Assessment(True, None, 0.9, None),
    )
    service = IngestionService(make_settings(tmp_path), [], lambda *a: None)
    item = _stream_item("r1", "Hochwasser am Konstanzer Hafen, Keller laufen voll")

    async def scenario() -> None:
        await service.startup()
        await service._ingest_stream_item(item)
        await service._ingest_stream_item(item)  # exact duplicate by key
        await service.aclose()

    asyncio.run(scenario())

    recent = service.recent_stream_posts()
    assert len(recent) == 1  # duplicate was dropped
    assert recent[0]["verdict"] == "verified"
    assert recent[0]["event_type"] == "flood"
    assert recent[0]["credibility_score"] == pytest.approx(0.9)
    assert service._stream_counters["accepted"] == 1
    assert service._stream_counters["duplicates"] == 1


def test_stream_consumer_defers_when_rate_capped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "ingestion.service.assess_report",
        lambda report: Assessment(True, None, 0.9, None),
    )
    service = IngestionService(
        make_settings(tmp_path, max_stream_analyses_per_min=1), [], lambda *a: None
    )

    async def scenario() -> None:
        await service.startup()
        await service._ingest_stream_item(
            _stream_item("r1", "Hochwasser am Konstanzer Hafen, Keller laufen voll")
        )
        await service._ingest_stream_item(
            _stream_item("r2", "Brand in der Radolfzeller Altstadt, Rauchsäule sichtbar")
        )
        await service.aclose()

    asyncio.run(scenario())

    assert service._stream_counters["accepted"] == 1
    assert service._stream_counters["rate_deferred"] == 1
    assert len(service.recent_stream_posts()) == 1


def test_stream_dropped_posts_short_circuit_on_requeue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fallback polling re-enqueues the same posts every cycle; ones already
    dropped (e.g. not crisis-relevant) must dedup instead of re-filtering."""
    monkeypatch.setattr(
        "ingestion.service.assess_report",
        lambda report: Assessment(True, None, 0.9, None),
    )
    service = IngestionService(make_settings(tmp_path), [], lambda *a: None)
    chatter = _stream_item("c1", "Schönes Stadtfest heute in Konstanz mit Musik")

    async def scenario() -> None:
        await service.startup()
        await service._ingest_stream_item(chatter)  # dropped: not crisis
        await service._ingest_stream_item(chatter)  # re-enqueued by fallback
        await service.aclose()

    asyncio.run(scenario())

    assert service._stream_counters["filtered"] == 1
    assert service._stream_counters["duplicates"] == 1  # negative cache hit


def test_streaming_status_surfaced_in_service_status(tmp_path: Path) -> None:
    service = IngestionService(make_settings(tmp_path), [], lambda *a: None)
    streaming_block = service.status()["streaming"]
    assert streaming_block["enabled"] is False
    assert streaming_block["posts_per_min"] == 0
    assert streaming_block["connections"] == []


def test_streaming_module_makes_no_network_at_import() -> None:
    # The module must be safely importable offline (uvicorn imports it always).
    assert hasattr(streaming, "run_bluesky_socket")
    assert hasattr(streaming, "run_mastodon_socket")
