"""Search-scope tests: registry completeness, containment, runtime switching,
API shape and geocoder re-biasing — fully offline."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from ingestion.base import FetchedItem
from ingestion.config import IngestionSettings
from ingestion.geocode import Geocoder
from ingestion.scopes import (
    DEFAULT_SCOPE_ID,
    GROUP_DE,
    GROUP_REGIONS,
    GROUP_US,
    SCOPES,
    scopes_for_api,
)
from ingestion.service import IngestionService
from ingestion.storage import FeedStore
from ingestion.streaming import jetstream_to_item
from logic.verification import Assessment

KONSTANZ = (47.6603, 9.1758)
NEW_YORK_CITY = (40.7128, -74.006)
MUNICH = (48.1372, 11.5755)


@pytest.fixture(autouse=True)
def _offline_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FEEDS_ENABLED", "false")
    monkeypatch.setenv("FEEDS_STREAMING", "false")
    for var in (
        "LITELLM_API_KEY",
        "LITELLM_API_KEYS",
        "USE_LIVE_AI",
        "USE_VISION",
        "LLM_MAX_CALLS",
        "SEARCH_SCOPE",
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
        "streaming_enabled": False,
    }
    base.update(overrides)
    return IngestionSettings(**base)


# --- registry ------------------------------------------------------------------------


def test_registry_has_all_required_presets() -> None:
    assert {"konstanz-sector", "germany", "usa", "european-union"} <= set(SCOPES)
    de_states = [s for s in SCOPES.values() if s.group == GROUP_DE]
    us_states = [s for s in SCOPES.values() if s.group == GROUP_US]
    regions = [s for s in SCOPES.values() if s.group == GROUP_REGIONS]
    assert len(de_states) == 16
    assert len(us_states) == 50
    assert len(regions) == 4
    assert len(SCOPES) == 70


def test_every_scope_is_well_formed() -> None:
    for scope in SCOPES.values():
        min_lat, min_lon, max_lat, max_lon = scope.bbox
        assert -90 <= min_lat < max_lat <= 90, scope.id
        assert -180 <= min_lon < max_lon <= 180, scope.id
        assert scope.countrycodes, scope.id
        assert scope.languages, scope.id
        assert scope.keywords, scope.id
        assert scope.hashtags(), scope.id
        assert 3 <= scope.zoom <= 12, scope.id


def test_eu_scope_lists_all_27_member_states() -> None:
    assert len(SCOPES["european-union"].countrycodes.split(",")) == 27


def test_containment_logic() -> None:
    lat, lon = KONSTANZ
    assert SCOPES["konstanz-sector"].contains(lat, lon)
    assert SCOPES["germany"].contains(lat, lon)
    assert SCOPES["baden-wuerttemberg"].contains(lat, lon)
    assert SCOPES["european-union"].contains(lat, lon)
    assert not SCOPES["usa"].contains(lat, lon)
    assert not SCOPES["bayern"].contains(lat, lon)

    ny_lat, ny_lon = NEW_YORK_CITY
    assert SCOPES["usa"].contains(ny_lat, ny_lon)
    assert SCOPES["us-new-york"].contains(ny_lat, ny_lon)
    assert not SCOPES["germany"].contains(ny_lat, ny_lon)

    mu_lat, mu_lon = MUNICH
    assert SCOPES["bayern"].contains(mu_lat, mu_lon)
    assert not SCOPES["baden-wuerttemberg"].contains(mu_lat, mu_lon)


def test_scopes_for_api_shape() -> None:
    payload = scopes_for_api("usa")
    assert payload["active"] == "usa"
    scopes = payload["scopes"]
    assert isinstance(scopes, list) and len(scopes) == 70
    groups = payload["groups"]
    assert [group["group"] for group in groups] == [GROUP_REGIONS, GROUP_DE, GROUP_US]
    assert sum(len(group["items"]) for group in groups) == 70
    sample = scopes[0]
    assert {"id", "label", "group", "bbox", "center", "zoom"} <= set(sample)


# --- firehose prefilter follows the scope ------------------------------------------------


def _bsky_event(text: str, langs: list[str]) -> dict[str, Any]:
    return {
        "did": "did:plc:test",
        "kind": "commit",
        "commit": {
            "operation": "create",
            "collection": "app.bsky.feed.post",
            "rkey": "3krkey",
            "record": {
                "$type": "app.bsky.feed.post",
                "createdAt": "2026-06-12T14:00:00.000Z",
                "langs": langs,
                "text": text,
            },
        },
    }


def test_usa_scope_keywords_accept_us_crisis_posts() -> None:
    usa = SCOPES["usa"]
    item = jetstream_to_item(
        _bsky_event("Major wildfire spreading near Los Angeles, evacuations underway", ["en"]),
        usa.keywords,
        usa.languages,
    )
    assert item is not None
    assert item.place_hint == "los angeles"

    # German-language post is rejected under the US scope's language filter
    assert (
        jetstream_to_item(
            _bsky_event("Hochwasser in Los Angeles angeblich!", ["de"]),
            usa.keywords,
            usa.languages,
        )
        is None
    )


def test_keyword_matching_requires_word_boundaries() -> None:
    usa = SCOPES["usa"]
    # "america" must not match inside an unrelated longer token
    assert (
        jetstream_to_item(
            _bsky_event("Fire alarm tests in americanizationville today ok", ["en"]),
            ("america",),
            usa.languages,
        )
        is None
    )


# --- runtime switching ----------------------------------------------------------------------


def _item(suffix: str, text: str, lat: float, lon: float) -> FetchedItem:
    return FetchedItem(
        source="bluesky",
        source_id=f"at://did:plc:test/app.bsky.feed.post/{suffix}",
        author="bsky:test",
        text=text,
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=1),
        lat=lat,
        lon=lon,
    )


def test_set_scope_wipes_store_and_filters_by_new_region(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "ingestion.service.assess_report",
        lambda report: Assessment(True, None, 0.9, None),
    )
    published: list[tuple[int, int]] = []
    service = IngestionService(
        make_settings(tmp_path),
        [],
        lambda credible, incidents, debunked: published.append(
            (len(incidents), len(debunked))
        ),
    )

    async def scenario() -> dict[str, Any]:
        await service.startup()
        # Konstanz scope accepts a Konstanz-located report
        await service._ingest_stream_item(
            _item("kn", "Hochwasser am Konstanzer Hafen, Keller voll", *KONSTANZ)
        )
        assert service._stream_counters["accepted"] == 1

        await service.set_scope(SCOPES["usa"])
        info_after = service.scope_info()
        # store wiped + republished empty
        assert published[-1] == (0, 0)
        assert await asyncio.to_thread(service._store.known_keys) == set()

        # Konstanz report is now off-sector; an NYC report is accepted
        await service._ingest_stream_item(
            _item("kn2", "Hochwasser am Konstanzer Hafen, Keller voll", *KONSTANZ)
        )
        await service._ingest_stream_item(
            _item("ny", "Apartment fire in Brooklyn, New York — heavy smoke", *NEW_YORK_CITY)
        )
        await service.aclose()
        return info_after

    info = asyncio.run(scenario())
    assert info["id"] == "usa"
    assert service._stream_counters["filtered"] == 1  # Konstanz post off-sector
    assert service._stream_counters["accepted"] == 1  # counters reset for the fresh scope
    assert service.recent_stream_posts()[0]["id"].startswith("BSKY-")


def test_unknown_search_scope_env_falls_back_to_konstanz(tmp_path: Path) -> None:
    service = IngestionService(
        make_settings(tmp_path, search_scope="atlantis"), [], lambda *a: None
    )
    assert service.scope_info()["id"] == "konstanz-sector"


def test_search_scope_env_selects_preset(tmp_path: Path) -> None:
    service = IngestionService(
        make_settings(tmp_path, search_scope="germany"), [], lambda *a: None
    )
    assert service.scope_info()["id"] == "germany"
    assert service.scope_info()["mode"] == "bbox"


# --- geocoder bias ---------------------------------------------------------------------------


def test_geocoder_uses_scope_countrycodes_and_viewbox(tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(dict(request.url.params))
        return httpx.Response(200, json=[{"lat": "40.7", "lon": "-74.0"}])

    store = FeedStore(tmp_path / "g.db")
    store.init()
    geocoder = Geocoder(make_settings(tmp_path, nominatim_enabled=True), store)
    usa = SCOPES["usa"]
    geocoder.set_scope(usa.countrycodes, usa.viewbox(), bounded=False)

    async def scenario() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            coords = await geocoder.resolve(client, "Brooklyn, NYC", "")
            assert coords == (40.7, -74.0)

    asyncio.run(scenario())
    assert captured["countrycodes"] == "us"
    assert captured["bounded"] == "0"
    assert captured["viewbox"] == usa.viewbox()


# --- API ----------------------------------------------------------------------------------------


def test_scope_endpoints_in_mock_mode() -> None:
    from main import app

    with TestClient(app) as client:
        listing = client.get("/api/scopes").json()
        assert listing["active"] == DEFAULT_SCOPE_ID
        assert len(listing["scopes"]) == 70

        ok = client.post("/api/scope", json={"id": "usa"})
        assert ok.status_code == 200
        assert ok.json()["status"] == "mock-mode"  # no live service to retarget
        assert ok.json()["scope"]["id"] == "usa"

        missing = client.post("/api/scope", json={"id": "narnia"})
        assert missing.status_code == 404
