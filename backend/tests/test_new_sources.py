"""Live-ingestion tests for the added open-data connectors.

Recorded fixtures + httpx.MockTransport only, zero network. Mirrors the style
of test_ingestion.py.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest

from ingestion.base import FetchedItem
from ingestion.config import IngestionSettings

FIXTURES: Path = Path(__file__).parent / "fixtures"


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
    }
    base.update(overrides)
    return IngestionSettings(**base)


def mock_client(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))



def test_pegelonline_parser_emits_only_high_water_gauges(tmp_path: Path) -> None:
    raw = json.loads(
        (FIXTURES / "pegelonline.json").read_text(encoding="utf-8")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=raw)

    from ingestion.pegelonline import PegelonlineConnector

    connector = PegelonlineConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())

    # PLAUE OP (stateMnwMhw=high) + PASSAU (stateNswHsw=veryhigh); CELLE (normal) skipped.
    assert len(items) == 2
    by_id = {item.source_id: item for item in items}
    assert "pegelonline:aa97c894-ed26-4fdd-945f-db9667979268" in by_id
    assert "pegelonline:11111111-2222-3333-4444-555555555555" in by_id

    for item in items:
        assert item.source == "pegelonline"
        assert item.event_type == "flood"
        assert item.author == "WSV PEGELONLINE"
        assert item.lat is not None and item.lon is not None
        assert item.timestamp.tzinfo is not None
        assert item.timestamp.utcoffset() == timedelta(0)  # tz-aware UTC

    plaue = by_id["pegelonline:aa97c894-ed26-4fdd-945f-db9667979268"]
    assert plaue.lat == pytest.approx(52.402702, abs=1e-5)
    assert plaue.lon == pytest.approx(12.393022, abs=1e-5)
    assert "PLAUE OP" in plaue.text
    assert "97 cm" in plaue.text
    assert plaue.timestamp == datetime(2026, 6, 12, 23, 45, tzinfo=timezone.utc)

    passau = by_id["pegelonline:11111111-2222-3333-4444-555555555555"]
    assert "742 cm" in passau.text
    assert "flood mark" in passau.text  # HSW (veryhigh) wording


def test_pegelonline_returns_empty_on_unexpected_payload(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    from ingestion.pegelonline import PegelonlineConnector

    connector = PegelonlineConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    assert asyncio.run(scenario()) == []



def test_usgs_parser_extracts_earthquakes_with_coords(tmp_path: Path) -> None:
    from ingestion.usgs import UsgsConnector

    raw = json.loads(
        (FIXTURES / "usgs_2.5_day.geojson").read_text(encoding="utf-8")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("2.5_day.geojson")
        return httpx.Response(200, json=raw)

    connector = UsgsConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())
    assert len(items) == 3

    for item in items:
        assert item.source == "usgs"
        assert item.author == "USGS"
        assert item.event_type == "earthquake"
        assert item.lat is not None and item.lon is not None
        assert item.timestamp.tzinfo is not None
        assert item.timestamp.utcoffset() == timezone.utc.utcoffset(None)

    pr = next(i for i in items if i.source_id == "pr71519693")
    assert pr.lat == pytest.approx(18.566, abs=0.001)
    assert pr.lon == pytest.approx(-66.4555, abs=0.001)
    assert "M 2.9 earthquake" in pr.text
    assert "Puerto Rico" in pr.text
    assert "depth 79 km" in pr.text  # metric units, rounded
    assert pr.url == "https://earthquake.usgs.gov/earthquakes/eventpage/pr71519693"
    assert pr.timestamp == datetime.fromtimestamp(
        1781303003010 / 1000.0, tz=timezone.utc
    )


def test_usgs_parser_is_defensive_on_garbage(tmp_path: Path) -> None:
    from ingestion.usgs import UsgsConnector

    bad = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature"},  # no geometry/properties
            {"type": "Feature", "geometry": {"coordinates": [1.0]}},  # short coords
            {
                "type": "Feature",
                "id": "ok1",
                "properties": {"mag": 5.1, "place": "Test Zone", "time": 1781303003010},
                "geometry": {"type": "Point", "coordinates": [9.17, 47.66, 5.0]},
            },
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=bad)

    connector = UsgsConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())
    assert len(items) == 1
    assert items[0].source_id == "ok1"
    assert items[0].event_type == "earthquake"
    assert items[0].lat == pytest.approx(47.66)


def test_usgs_fetch_swallows_http_errors(tmp_path: Path) -> None:
    from ingestion.usgs import UsgsConnector

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    connector = UsgsConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    assert asyncio.run(scenario()) == []



def test_eonet_parser_maps_categories_geolocates_and_skips_untaxonomised(
    tmp_path: Path,
) -> None:
    from ingestion.eonet import EonetConnector
    from logic.guidance import KNOWN_EVENT_TYPES

    raw = json.loads(
        (FIXTURES / "eonet_events.json").read_text(encoding="utf-8")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert "eonet.gsfc.nasa.gov" in request.url.host
        return httpx.Response(200, json=raw)

    connector = EonetConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())

    # 4 events in, the volcano (no taxonomy match) is skipped -> 3 emitted.
    assert len(items) == 3
    by_id = {item.source_id: item for item in items}
    assert "EONET_14004" not in by_id  # volcano skipped, not invented

    for item in items:
        assert item.source == "eonet"
        assert item.author == "NASA EONET"
        assert item.event_type in KNOWN_EVENT_TYPES
        assert item.lat is not None and item.lon is not None
        assert item.timestamp.tzinfo is not None  # tz-aware
        assert item.timestamp.utcoffset() == timedelta(0)  # normalised to UTC

    fire = by_id["EONET_14001"]
    assert fire.event_type == "wildfire"
    # Latest Point geometry wins: coordinates are [lon, lat].
    assert fire.lon == pytest.approx(-120.91, abs=1e-6)
    assert fire.lat == pytest.approx(40.18, abs=1e-6)
    assert fire.timestamp == datetime(2026, 6, 12, 12, 0, tzinfo=timezone.utc)

    storm = by_id["EONET_14002"]
    assert storm.event_type == "storm"
    # Polygon -> representative (mean) point of the distinct ring vertices.
    # The closed-ring duplicate first/last vertex is dropped before averaging,
    # so the mean is the centroid of the four corners (129.0, 15.0).
    assert storm.lon == pytest.approx(129.0, abs=1e-6)
    assert storm.lat == pytest.approx(15.0, abs=1e-6)

    flood = by_id["EONET_14003"]
    assert flood.event_type == "flood"
    assert flood.lon == pytest.approx(92.93, abs=1e-6)
    assert flood.lat == pytest.approx(26.20, abs=1e-6)


def test_eonet_fetch_is_defensive_on_garbage(tmp_path: Path) -> None:
    from ingestion.eonet import EonetConnector

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "events": [
                    {"id": "X1"},  # no title
                    {"id": "X2", "title": "No geometry", "categories": [
                        {"id": "wildfires", "title": "Wildfires"}]},
                    {"id": "X3", "title": "No category", "geometry": [
                        {"type": "Point", "coordinates": [9.0, 47.0],
                         "date": "2026-06-12T00:00:00Z"}]},
                    "not-a-dict",
                ]
            },
        )

    connector = EonetConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    assert asyncio.run(scenario()) == []


def test_eonet_fetch_swallows_http_errors(tmp_path: Path) -> None:
    from ingestion.eonet import EonetConnector

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    connector = EonetConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    assert asyncio.run(scenario()) == []



def test_gdacs_parser_maps_codes_geocodes_and_skips_unmapped(
    tmp_path: Path,
) -> None:
    from ingestion.gdacs import GdacsConnector

    raw = (FIXTURES / "gdacs_rss.xml").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "www.gdacs.org"
        return httpx.Response(
            200, text=raw, headers={"Content-Type": "application/rss+xml"}
        )

    connector = GdacsConnector(make_settings(tmp_path, gdacs_enabled=True))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())

    # FL, EQ, TC are mapped; the DR (drought) item is skipped.
    assert len(items) == 3
    by_type = {item.event_type: item for item in items}
    assert set(by_type) == {"flood", "earthquake", "storm"}

    for item in items:
        assert item.source == "gdacs"
        assert item.author == "GDACS (EC-JRC)"
        assert item.event_type in {"flood", "earthquake", "storm", "wildfire"}
        assert item.lat is not None and item.lon is not None
        assert isinstance(item.lat, float) and isinstance(item.lon, float)
        assert item.timestamp.tzinfo is not None
        assert item.timestamp.utcoffset() == timedelta(0)  # tz-aware UTC
        assert item.source_id

    flood = by_type["flood"]
    assert flood.source_id == "FL1103920"
    # georss:point is "lat lon"; feedparser stores GeoJSON (lon, lat).
    assert flood.lat == pytest.approx(37.2401223, abs=1e-6)
    assert flood.lon == pytest.approx(36.4534072, abs=1e-6)
    assert flood.timestamp == datetime(2026, 6, 2, 5, 45, 56, tzinfo=timezone.utc)
    assert flood.url == (
        "https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1103920"
    )

    storm = by_type["storm"]
    assert storm.lat == pytest.approx(13.2, abs=1e-6)
    assert storm.lon == pytest.approx(-89.1, abs=1e-6)

    quake = by_type["earthquake"]
    assert quake.lat == pytest.approx(-27.8038, abs=1e-6)
    assert quake.lon == pytest.approx(-71.7406, abs=1e-6)

    # No drought leaks through (DR has no clean taxonomy match).
    assert all("DR" not in item.source_id for item in items)


def test_gdacs_disabled_yields_nothing_and_does_not_call_network(
    tmp_path: Path,
) -> None:
    from ingestion.gdacs import GdacsConnector

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("disabled connector must not hit the network")

    connector = GdacsConnector(make_settings(tmp_path, gdacs_enabled=False))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    assert asyncio.run(scenario()) == []
