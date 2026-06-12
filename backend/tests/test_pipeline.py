"""Happy-path tests: schema parsing, credibility rules, 1 km clustering,
live report injection, and the (mocked — zero network) live LLM analyst."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from logic import verification
from logic.geospatial import cluster_reports
from logic.guidance import severity_for
from logic.verification import assess_report
from main import load_raw_reports, reset_state, run_pipeline, state, submit_report
from schemas import RawReport, ReportSubmission

NOW = datetime(2026, 6, 12, 14, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _default_mock_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test is deterministic/offline unless it opts into (fake) live mode."""
    for var in (
        "LITELLM_API_KEY",
        "LITELLM_API_KEYS",
        "USE_LIVE_AI",
        "USE_VISION",
        "LLM_MAX_CALLS",
    ):
        monkeypatch.delenv(var, raising=False)
    verification.reset_call_budget()


def make_report(**overrides: object) -> RawReport:
    base: dict[str, object] = {
        "id": "RPT-T1",
        "source": "twitter",
        "author": "@test",
        "text": "Wasser auf der Seestraße",
        "event_type": "flood",
        "lat": 47.6603,
        "lon": 9.1758,
        "timestamp": NOW,
    }
    base.update(overrides)
    return RawReport.model_validate(base)


# --- Heuristic layer ------------------------------------------------------------


def test_mock_data_matches_raw_report_schema() -> None:
    reports = load_raw_reports()
    assert len(reports) == 60


def test_recycled_footage_is_flagged() -> None:
    report = make_report(exif_timestamp=NOW - timedelta(hours=72))
    assessment = assess_report(report)
    assert not assessment.credible
    assert "Recycled footage" in (assessment.reason or "")


def test_bot_spam_is_flagged() -> None:
    report = make_report(text="BREAKING!!! SHARE BEFORE THEY DELETE this!!!")
    assert not assess_report(report).credible


def test_geotag_conflict_is_flagged() -> None:
    # Claims Konstanz, but the media EXIF geotag sits in Stuttgart (~124 km away).
    report = make_report(exif_lat=48.7758, exif_lon=9.1829, exif_timestamp=NOW)
    assessment = assess_report(report)
    assert not assessment.credible
    assert "Geotag conflict" in (assessment.reason or "")


def test_fresh_local_report_is_credible() -> None:
    report = make_report(exif_timestamp=NOW - timedelta(minutes=4))
    assert assess_report(report).credible


# --- Geospatial clustering -------------------------------------------------------


def test_reports_within_radius_and_window_merge() -> None:
    a = make_report(id="A", lat=47.6597, lon=9.1780, timestamp=NOW)
    b = make_report(id="B", lat=47.6622, lon=9.1795, timestamp=NOW + timedelta(minutes=20))
    c = make_report(id="C", event_type="fire", lat=47.6663, lon=9.1748, timestamp=NOW)
    incidents = cluster_reports([a, b, c])
    assert len(incidents) == 2
    flood = next(i for i in incidents if i.event_type == "flood")
    assert sorted(flood.source_ids) == ["A", "B"]
    assert flood.report_count == 2


def test_reports_outside_radius_stay_separate() -> None:
    a = make_report(id="A")
    b = make_report(id="B", lat=47.6803, lon=9.2058)  # ~3 km away
    incidents = cluster_reports([a, b])
    assert len(incidents) == 2


def test_full_pipeline_on_mock_data() -> None:
    result = run_pipeline(load_raw_reports())
    # The 60-report demo dataset: 25 credible posts clustering into incidents,
    # 35 disinformation posts caught by the heuristics (bot-spam markers,
    # recycled-footage EXIF gaps, geotag conflicts).
    assert len(result["debunked"]) == 35
    assert sum(i.report_count for i in result["incidents"]) == 25
    types = {i.event_type for i in result["incidents"]}
    assert {"flood", "fire", "storm", "power_outage"} <= types


# --- Responder guidance (severity + action hints) ---------------------------------


def test_severity_grading() -> None:
    assert severity_for("fire") == "high"
    assert severity_for("storm") == "moderate"
    assert severity_for("unknown_event") == "low"


def test_bw_ministry_taxonomy_is_complete() -> None:
    """Every class in the BW crisis catalogue has a hint and a severity."""
    from logic.guidance import KNOWN_EVENT_TYPES, action_hint

    expected_subset = {
        "flood", "storm", "wildfire", "earthquake", "heatwave", "cold_spell",
        "fire", "explosion", "chemical_accident", "hazmat", "accident",
        "infrastructure_failure", "nuclear_accident", "radiological",
        "biological", "chemical_attack", "pandemic", "terror_attack",
        "cbrn_attack", "hostage", "sabotage", "power_outage",
        "telecom_failure", "water_supply", "food_supply", "supply_chain",
        "evacuation",
    }
    assert expected_subset <= set(KNOWN_EVENT_TYPES)
    for event_type in KNOWN_EVENT_TYPES:
        assert action_hint(event_type, 3, 0.9)
        assert severity_for(event_type) in {"high", "moderate", "low"}


def test_incidents_carry_guidance_and_sources() -> None:
    result = run_pipeline(load_raw_reports())
    flood = next(i for i in result["incidents"] if i.event_type == "flood")
    assert flood.severity == "high"
    assert flood.action_hint and "Low corroboration" not in flood.action_hint
    assert len(flood.sources) == flood.report_count
    # chronological source timeline
    stamps = [s.timestamp for s in flood.sources]
    assert stamps == sorted(stamps)


def test_single_source_incident_gets_low_corroboration_hint() -> None:
    result = run_pipeline(load_raw_reports())
    singles = [i for i in result["incidents"] if i.report_count == 1]
    assert singles, "demo dataset should contain single-source incidents"
    for incident in singles:
        assert incident.action_hint.startswith("Low corroboration")


# --- Live injection (POST /api/reports) ------------------------------------------


def test_inject_corroborating_flood_merges() -> None:
    reset_state()
    before = next(i for i in state["incidents"] if i.event_type == "flood")
    result = submit_report(
        ReportSubmission(
            author="@hafen_kn",
            text="Wasser steht jetzt auch in der Tiefgarage am Hafen",
            event_type="flood",
            lat=47.6609,
            lon=9.1786,
        )
    )
    assert result.verdict == "verified"
    after = next(i for i in state["incidents"] if i.event_type == "flood")
    assert after.report_count == before.report_count + 1
    assert result.incident_id == after.id


def test_inject_new_sector_creates_incident() -> None:
    reset_state()
    before = len(state["incidents"])
    result = submit_report(
        ReportSubmission(
            author="kn_warnkanal",
            text="Sturmböen werfen Bäume auf die Mainaustraße bei Litzelstetten",
            event_type="storm",
            lat=47.6985,
            lon=9.192,
        )
    )
    assert result.verdict == "verified"
    assert len(state["incidents"]) == before + 1


def test_inject_recycled_footage_is_debunked() -> None:
    reset_state()
    before = len(state["debunked"])
    result = submit_report(
        ReportSubmission(
            author="altvideo_kanal",
            text="Aktuelle Aufnahmen vom Hochwasser in Konstanz!",
            event_type="flood",
            lat=47.6614,
            lon=9.178,
            exif_timestamp=datetime.now(timezone.utc) - timedelta(hours=72),
        )
    )
    assert result.verdict == "debunked"
    assert "Recycled footage" in (result.reason_flagged or "")
    assert len(state["debunked"]) == before + 1


def test_inject_botspam_is_debunked() -> None:
    reset_state()
    result = submit_report(
        ReportSubmission(
            author="panik_news_de",
            text="BREAKING!!! Staudamm gebrochen! SHARE BEFORE THEY DELETE THIS!",
            event_type="flood",
            lat=47.6588,
            lon=9.1705,
        )
    )
    assert result.verdict == "debunked"


# --- Live LLM analyst (mocked OpenAI client — ZERO network) -----------------------


class _FakeClient:
    """Stands in for the OpenAI client; returns a canned chat completion."""

    def __init__(self, payload: str) -> None:
        message = SimpleNamespace(content=payload)
        response = SimpleNamespace(choices=[SimpleNamespace(message=message)])
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=lambda **_: response)
        )


class _ExplodingClient:
    """Simulates gateway/network failure on every call."""

    def __init__(self) -> None:
        def _boom(**_: object) -> object:
            raise RuntimeError("gateway unreachable")

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=_boom))


def _enable_live(monkeypatch: pytest.MonkeyPatch, client: object) -> None:
    monkeypatch.setenv("LITELLM_API_KEY", "test-key")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    monkeypatch.setattr(verification, "_client_for", lambda key: client)


def test_ai_mode_states(monkeypatch: pytest.MonkeyPatch) -> None:
    assert verification.ai_mode() == "mock"
    monkeypatch.setenv("LITELLM_API_KEY", "k")
    assert verification.ai_mode() == "live-ready"
    monkeypatch.setenv("USE_LIVE_AI", "true")
    assert verification.ai_mode() == "live"


def test_llm_valid_json_maps_to_credible(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = (
        '{"is_credible": true, "event_type": "fire",'
        ' "credibility_score": 0.83, "reason_flagged": null}'
    )
    _enable_live(monkeypatch, _FakeClient(payload))
    assessment = verification.assess_report(make_report())
    assert assessment.credible
    assert assessment.score == pytest.approx(0.83)
    assert assessment.event_type == "fire"


def test_llm_valid_json_maps_to_debunked(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = (
        '{"is_credible": false, "event_type": "flood",'
        ' "credibility_score": 0.12, "reason_flagged": "Exaggerated mass-share bait"}'
    )
    _enable_live(monkeypatch, _FakeClient(payload))
    assessment = verification.assess_report(make_report())
    assert not assessment.credible
    assert assessment.reason == "Exaggerated mass-share bait"


def test_llm_fenced_json_still_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = (
        "```json\n"
        '{"is_credible": true, "event_type": "flood",'
        ' "credibility_score": 0.7, "reason_flagged": null}\n'
        "```"
    )
    _enable_live(monkeypatch, _FakeClient(payload))
    assert verification.assess_report(make_report()).credible


def test_llm_malformed_json_is_parsing_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_live(monkeypatch, _FakeClient("This report seems fine to me."))
    assessment = verification.assess_report(make_report())
    assert not assessment.credible
    assert assessment.reason == "AI Parsing Error"


def test_llm_infra_failure_falls_back_to_heuristics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_live(monkeypatch, _ExplodingClient())
    assessment = verification.assess_report(make_report())  # heuristically clean
    assert assessment.credible  # graceful degradation, not a false debunk
    assert assessment.score == pytest.approx(0.90)  # heuristic score


def test_heuristics_short_circuit_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def _tracking_client(key: str) -> object:
        calls.append("client")
        return _FakeClient(
            '{"is_credible": true, "event_type": "flood",'
            ' "credibility_score": 0.9, "reason_flagged": null}'
        )

    monkeypatch.setenv("LITELLM_API_KEY", "test-key")
    monkeypatch.setenv("USE_LIVE_AI", "true")
    monkeypatch.setattr(verification, "_client_for", _tracking_client)
    assessment = verification.assess_report(
        make_report(text="SHARE BEFORE THEY DELETE this!!!")
    )
    assert not assessment.credible
    assert calls == []  # metadata heuristics reject without consulting the LLM


def test_llm_event_type_refines_classification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = (
        '{"is_credible": true, "event_type": "fire",'
        ' "credibility_score": 0.8, "reason_flagged": null}'
    )
    _enable_live(monkeypatch, _FakeClient(payload))
    credible, debunked = verification.filter_reports([make_report()])  # typed flood
    assert debunked == []
    assert credible[0].event_type == "fire"  # LLM refinement applied pre-clustering
