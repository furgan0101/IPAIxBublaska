"""Live-ingestion tests — recorded fixtures + fakes only, ZERO network.

httpx.MockTransport replays recorded upstream payloads (Presseportal RSS and
Mastodon recorded live; NINA synthesised to the documented api31 schema since
no warning was active at recording time). Service tests run on a tmp_path
SQLite store with Nominatim disabled and the credibility layer in its offline
heuristic mode.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest

from ingestion.base import FetchedItem, html_to_text, parse_utc
from ingestion.classify import classify
from ingestion.config import IngestionSettings
from ingestion import gazetteer
from ingestion.feuerwehr import FeuerwehrConnector
from ingestion.geocode import place_candidates
from ingestion.mastodon import MastodonConnector
from ingestion.nina import NinaConnector
from ingestion.presseportal import PresseportalConnector
from ingestion.service import IngestionService
from ingestion.storage import FeedStore, content_hash
from logic.verification import Assessment
from schemas import RawReport

FIXTURES: Path = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _offline_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deterministic offline heuristics — never a live LLM call in tests."""
    for var in ("LITELLM_API_KEY", "USE_LIVE_AI", "USE_VISION"):
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
    }
    base.update(overrides)
    return IngestionSettings(**base)


def mock_client(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# --- classifier --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Wasser läuft über die Hafenpromenade — Pegel steigt schnell", "flood"),
        ("Rauchsäule über der Niederburg, brennt ein Dachstuhl?", "fire"),
        ("Sturmböe hat mehrere Bäume im Herosé-Park umgeworfen", "storm"),
        ("Amtliche WARNUNG vor GEWITTER mit STARKREGEN", "storm"),
        ("Stromausfall in Teilen von Petershausen-Ost", "power_outage"),
        ("POL-KN: (Singen) Verkehrsunfall mit zwei Verletzten", "accident"),
        ("Fliegerbombe gefunden — Evakuierung wird vorbereitet", "evacuation"),
        ("Gasgeruch in der Innenstadt, Feuerwehr misst", "hazmat"),
        ("Waldbrand am Bodanrück breitet sich aus", "wildfire"),
        ("Trinkwasser verunreinigt — Abkochgebot erlassen", "water_supply"),
    ],
)
def test_classifier_maps_german_crisis_text(text: str, expected: str) -> None:
    assert classify(text) == expected


def test_classifier_drops_non_crisis_chatter() -> None:
    assert classify("Stadtfest am Wochenende in Konstanz mit Livemusik") is None
    assert classify("Neue Fahrradständer am Bahnhof eingeweiht") is None


def test_classifier_matches_every_credible_mock_report() -> None:
    """The keyword classifier must agree with the curated mock feed."""
    from logic.verification import filter_reports
    from main import load_raw_reports

    credible, _ = filter_reports(load_raw_reports())
    assert credible  # sanity: the mock feed has credible reports
    for report in credible:
        assert classify(report.text) is not None, report.id


# --- gazetteer + place hints ----------------------------------------------------------


def test_gazetteer_finds_sector_places() -> None:
    assert gazetteer.find("Brand in Singen am Bahnhof") == gazetteer.PLACES["singen"]
    assert (
        gazetteer.find("(Radolfzell, B 33 / Lkr. Konstanz) Unfall")
        == gazetteer.PLACES["radolfzell"]
    )
    assert gazetteer.find("irgendwo am See, nichts Genaues") is None


def test_gazetteer_resolves_landmarks_offline() -> None:
    """Sub-city landmarks pin precisely, beating the town centroid."""
    ferry = gazetteer.LANDMARKS["fährhafen staad"]
    assert gazetteer.find("Rauchsäule am Fährhafen Staad sichtbar") == ferry
    assert ferry != gazetteer.PLACES["staad"]  # landmark, not the district pin
    assert (
        gazetteer.find("Menschenmenge vor dem Konzil Konstanz")
        == gazetteer.LANDMARKS["konzil konstanz"]
    )
    assert (
        gazetteer.find("Polizeieinsatz am Herosé-Park")
        == gazetteer.LANDMARKS["herosé-park"]
    )
    assert (
        gazetteer.find("Smoke near the cathedral reported")
        == gazetteer.LANDMARKS["cathedral"]
    )


def test_place_candidates_strip_roads_and_district_qualifiers() -> None:
    hint = "Talheim, K 5919, B 523 / Lkr. Tuttlingen"
    assert place_candidates(hint) == ["Talheim", "Tuttlingen"]


# --- helpers --------------------------------------------------------------------------


def test_parse_utc_handles_zulu_and_offsets() -> None:
    zulu = parse_utc("2026-06-11T20:33:01.840Z")
    assert zulu.tzinfo == timezone.utc
    offset = parse_utc("2026-06-12T05:45:00+02:00")
    assert offset == datetime(2026, 6, 12, 3, 45, tzinfo=timezone.utc)


def test_html_to_text_strips_markup() -> None:
    markup = '<p>Wasser &amp; Schlamm <a href="x">auf der B33</a></p>'
    assert html_to_text(markup) == "Wasser & Schlamm auf der B33"


def test_content_hash_ignores_case_and_punctuation() -> None:
    assert content_hash("Brand in der Rheingasse!!") == content_hash(
        "brand in der RHEINGASSE"
    )


# --- connectors (recorded fixtures via MockTransport) -----------------------------------


def test_presseportal_parser_extracts_items_and_place_hints(tmp_path: Path) -> None:
    raw = (FIXTURES / "presseportal_kn.rss2.xml").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, text=raw, headers={"Content-Type": "application/rss+xml"}
        )

    connector = PresseportalConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())
    assert len(items) == 4
    for item in items:
        assert item.source == "presseportal"
        assert item.source_id.startswith("https://www.presseportal.de")
        assert item.timestamp.tzinfo is not None
        assert item.place_hint, "police titles carry a (Ort / Lkr.) prefix"
        assert "Polizeipräsidium" in item.author


def test_feuerwehr_connector_reuses_rss_parser_and_retags_source(
    tmp_path: Path,
) -> None:
    # Same Presseportal RSS shape as police; only the channel differs.
    raw = (FIXTURES / "presseportal_kn.rss2.xml").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, text=raw, headers={"Content-Type": "application/rss+xml"}
        )

    connector = FeuerwehrConnector(
        make_settings(tmp_path, fire_feeds=("https://feeds.example/fw.rss2",))
    )

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())
    assert items, "fire feed should yield items"
    assert all(item.source == "feuerwehr" for item in items)
    assert all(item.place_hint for item in items)  # parser still extracts (Ort)


def test_mastodon_parser_strips_html_and_skips_nothing_recorded(
    tmp_path: Path,
) -> None:
    raw = json.loads(
        (FIXTURES / "mastodon_konstanz.json").read_text(encoding="utf-8")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=raw)

    connector = MastodonConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())
    assert len(items) == 3  # all recorded statuses are de/non-reblog
    for item in items:
        assert item.source == "mastodon"
        assert item.author.startswith("@")
        assert "<" not in item.text  # HTML stripped
        assert item.timestamp.tzinfo is not None


def test_nina_parser_classifies_and_locates_warnings(tmp_path: Path) -> None:
    dashboard = json.loads(
        (FIXTURES / "nina_dashboard.json").read_text(encoding="utf-8")
    )
    geojson = json.loads(
        (FIXTURES / "nina_warning_se001.geojson").read_text(encoding="utf-8")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api31/dashboard/083350000000.json":
            return httpx.Response(200, json=dashboard)
        if path.endswith(".geojson") and "SE001" in path:
            return httpx.Response(200, json=geojson)
        return httpx.Response(404)

    connector = NinaConnector(make_settings(tmp_path))

    async def scenario() -> list[FetchedItem]:
        async with mock_client(handler) as client:
            return await connector.fetch(client)

    items = asyncio.run(scenario())
    assert len(items) == 2  # the Cancel entry is skipped

    flood = next(i for i in items if i.source_id.startswith("mow."))
    assert flood.event_type == "flood"
    assert flood.author == "MOWAS"
    assert flood.lat == pytest.approx(47.648, abs=0.001)  # polygon centroid
    assert flood.lon == pytest.approx(9.16, abs=0.001)

    dwd = next(i for i in items if i.source_id.startswith("dwd."))
    assert dwd.event_type == "storm"
    assert dwd.lat is None  # no geometry -> service pins the sector centre


# --- storage ---------------------------------------------------------------------------


def test_storage_roundtrip_and_geocode_cache(tmp_path: Path) -> None:
    store = FeedStore(tmp_path / "t.db")
    store.init()
    now = datetime.now(timezone.utc)
    report = RawReport(
        id="POL-AAAA1111",
        source="presseportal",
        author="Polizeipräsidium Konstanz",
        text="Brand in Singen",
        event_type="fire",
        lat=47.7623,
        lon=8.84,
        timestamp=now,
        url="https://example.org/pm",
    )
    store.add_report("presseportal:x", "h1", report, True, None, 0.9, now)
    assert store.known_keys() == {"presseportal:x"}
    assert store.known_hashes() == {"h1"}
    loaded = store.load_recent(now - timedelta(hours=1))
    assert len(loaded) == 1
    assert loaded[0].report.url == "https://example.org/pm"
    assert store.load_recent(now + timedelta(hours=1)) == []

    store.geocode_put("talheim", (48.0, 8.78), now)
    store.geocode_put("nirgendwo", None, now)  # known miss
    assert store.geocode_get("talheim") == (48.0, 8.78)
    assert store.geocode_has("nirgendwo") and store.geocode_get("nirgendwo") is None
    assert not store.geocode_has("unbekannt")

    store.clear()
    assert store.known_keys() == set()


def test_dispatched_incidents_roundtrip(tmp_path: Path) -> None:
    store = FeedStore(tmp_path / "t.db")
    store.init()
    now = datetime.now(timezone.utc)

    store.set_dispatched("INC-001", now, ["Confirm fire-brigade dispatch", "Cordon"])
    store.set_dispatched("INC-002", now, [])  # auto-alert: dispatch without checklist

    loaded = store.load_dispatched()
    assert set(loaded) == {"INC-001", "INC-002"}
    assert loaded["INC-001"].dispatched_at == now
    assert loaded["INC-001"].completed_tasks == ["Confirm fire-brigade dispatch", "Cordon"]
    assert loaded["INC-002"].completed_tasks == []

    # INSERT OR REPLACE: a second dispatch of the same id overwrites cleanly.
    store.set_dispatched("INC-001", now, ["Confirm fire-brigade dispatch", "Cordon", "Reroute"])
    assert store.load_dispatched()["INC-001"].completed_tasks[-1] == "Reroute"

    store.clear_dispatched()
    assert store.load_dispatched() == {}


def test_persisted_dispatch_reapplied_on_rebuild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A dispatch persisted to SQLite must be re-applied (dispatched=True,
    matching SOP tasks completed) when incidents are rebuilt from scratch —
    the restart-survival contract."""
    import main
    from logic.geospatial import cluster_reports

    settings = make_settings(tmp_path)
    service = IngestionService(settings, [FakeConnector([])], lambda *a: None)
    service._store.init()
    monkeypatch.setattr(main, "ingestion_service", service)
    monkeypatch.setattr(main, "_dispatch_hydrated", False)
    main._dispatch_registry.clear()

    now = datetime.now(timezone.utc)
    fire_tasks = [
        "Confirm fire-brigade dispatch",
        "Establish 300 m cordon",
        "Reroute pedestrian/car traffic",
    ]
    # Persist the dispatch BEFORE the incident exists in memory (simulating a
    # restart: registry is empty, only SQLite remembers the handoff).
    service.record_dispatch("INC-001", now, fire_tasks)

    reports = [
        RawReport(
            id=f"F{i}",
            source="twitter",
            author="@witness",
            text="Brand am Bahnhof Konstanz",
            event_type="fire",
            lat=47.6603,
            lon=9.1758,
            timestamp=now + timedelta(minutes=i),
        )
        for i in range(3)
    ]
    incidents = main._apply_dispatch_state(cluster_reports(reports))
    assert main._dispatch_hydrated  # hydrated from SQLite on first rebuild

    incident = incidents[0]
    assert incident.id == "INC-001"
    assert incident.dispatched and incident.dispatched_at == now
    assert all(task.completed for task in incident.sop_tasks)

    main._dispatch_registry.clear()


# --- ingestion service (end to end, fake connector) ---------------------------------------


class FakeConnector:
    name = "fake"

    def __init__(self, items: list[FetchedItem]) -> None:
        self._items = items

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        return list(self._items)


def capture() -> tuple[dict[str, Any], Any]:
    captured: dict[str, Any] = {}

    def publish(credible: Any, incidents: Any, debunked: Any) -> None:
        captured["credible"] = credible
        captured["incidents"] = incidents
        captured["debunked"] = debunked

    return captured, publish


def _scenario_items(now: datetime) -> list[FetchedItem]:
    return [
        FetchedItem(  # verified: classifiable + gazetteer-locatable
            source="fake",
            source_id="a1",
            author="kn_melder",
            text="Brand in der Rheingasse Konstanz, Feuerwehr im Einsatz",
            timestamp=now - timedelta(minutes=5),
        ),
        FetchedItem(  # debunked: bot-spam marker
            source="fake",
            source_id="a2",
            author="panik_bot",
            text="MEGA Brand in Konstanz!! SHARE BEFORE THEY DELETE this!!!",
            timestamp=now - timedelta(minutes=4),
        ),
        FetchedItem(  # off sector: Stuttgart is ~125 km away
            source="fake",
            source_id="a3",
            author="stgt_news",
            text="Stromausfall in Stuttgart-Mitte",
            timestamp=now - timedelta(minutes=3),
            lat=48.7758,
            lon=9.1829,
        ),
        FetchedItem(  # not crisis-relevant
            source="fake",
            source_id="a4",
            author="kultur_kn",
            text="Tolles Open-Air-Konzert heute Abend in Konstanz!",
            timestamp=now - timedelta(minutes=2),
        ),
        FetchedItem(  # unlocatable (no known place, Nominatim off)
            source="fake",
            source_id="a5",
            author="anon",
            text="Überflutung am alten Hafenbecken",
            timestamp=now - timedelta(minutes=1),
        ),
        FetchedItem(  # content duplicate of a1
            source="fake",
            source_id="a6",
            author="kn_mirror",
            text="Brand in der Rheingasse Konstanz, Feuerwehr im Einsatz",
            timestamp=now,
        ),
    ]


def test_service_poll_filters_dedups_verifies_and_publishes(tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    captured, publish = capture()
    service = IngestionService(
        make_settings(tmp_path),
        [FakeConnector(_scenario_items(now))],
        publish,
    )

    async def scenario() -> tuple[dict[str, int], dict[str, int]]:
        await service.startup()
        first = await service.poll_once()
        second = await service.poll_once()
        await service.aclose()
        return first, second

    first, second = asyncio.run(scenario())

    assert first == {
        "fetched": 6,
        "new_verified": 1,
        "new_debunked": 1,
        "duplicates": 1,  # a6 (content hash)
        "not_crisis": 1,  # a4
        "unlocated": 1,  # a5
        "off_sector": 1,  # a3
        "stale": 0,
    }
    # second cycle: everything known or re-dropped, nothing new
    assert second["new_verified"] == 0 and second["new_debunked"] == 0
    assert second["duplicates"] == 3  # a1 + a2 by key, a6 by content hash

    incidents = captured["incidents"]
    assert len(incidents) == 1
    incident = incidents[0]
    assert incident.event_type == "fire"
    assert incident.report_count == 1
    assert incident.sources[0].id.startswith("LIVE-")
    assert incident.action_hint.startswith("Low corroboration")

    debunked = captured["debunked"]
    assert len(debunked) == 1
    assert "Bot-spam" in debunked[0].reason_flagged


def test_service_state_survives_restart(tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    settings = make_settings(tmp_path)
    captured1, publish1 = capture()
    service1 = IngestionService(
        settings, [FakeConnector(_scenario_items(now))], publish1
    )

    async def first_run() -> None:
        await service1.startup()
        await service1.poll_once()
        await service1.aclose()

    asyncio.run(first_run())
    assert len(captured1["incidents"]) == 1

    captured2, publish2 = capture()
    service2 = IngestionService(settings, [FakeConnector([])], publish2)

    async def restart() -> None:
        await service2.startup()  # publishes from SQLite, no poll needed
        await service2.aclose()

    asyncio.run(restart())
    assert len(captured2["incidents"]) == 1
    assert captured2["incidents"][0].event_type == "fire"
    assert len(captured2["debunked"]) == 1


def test_official_single_source_gets_confidence_floor(tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    warning = FetchedItem(
        source="nina",
        source_id="mow.test-1",
        author="MOWAS",
        text="Amtliche WARNUNG vor HOCHWASSER am Bodensee",
        timestamp=now,
        event_type="flood",
        lat=47.66,
        lon=9.17,
    )
    captured, publish = capture()
    service = IngestionService(
        make_settings(tmp_path), [FakeConnector([warning])], publish
    )

    async def scenario() -> None:
        await service.startup()
        await service.poll_once()
        await service.aclose()

    asyncio.run(scenario())
    incident = captured["incidents"][0]
    assert incident.confidence_score == pytest.approx(0.90)
    assert not incident.action_hint.startswith("Low corroboration")
    assert incident.sources[0].id.startswith("NINA-")


def test_manual_injection_is_persisted_for_live_mode(tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    settings = make_settings(tmp_path)
    captured, publish = capture()
    service = IngestionService(settings, [FakeConnector([])], publish)

    report = RawReport(
        id="RPT-LIVE-001",
        source="live",
        author="@demo",
        text="Brand am Stadtgarten",
        event_type="fire",
        lat=47.6622,
        lon=9.1795,
        timestamp=now,
    )

    async def scenario() -> None:
        await service.startup()
        service.persist_manual(report, Assessment(True, None, 0.9, None))
        await service.poll_once()  # rebuild includes the manual report
        await service.aclose()

    asyncio.run(scenario())
    assert any(
        "RPT-LIVE-001" in incident.source_ids
        for incident in captured["incidents"]
    )
