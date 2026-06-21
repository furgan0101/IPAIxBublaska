"""Happy-path tests: schema parsing, credibility rules, 1 km clustering,
live report injection, and the (mocked — zero network) live LLM analyst."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from logic import verification
from logic.geospatial import cluster_reports
from logic.guidance import severity_for
from logic.verification import assess_report, filter_reports
from main import (
    _apply_dispatch_state,
    _dispatch_registry,
    run_pipeline,
    state,
    submit_report,
)
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


# A small, explicit Konstanz-sector report set for pipeline-level tests. The
# production API is fed exclusively by the live ingestion service; this inline
# fixture stands in for "a batch of reports" so the filter + clustering + state
# assembly stay covered offline (zero network), with no synthetic product feed.
# Stamped at real "now" so live injections (also stamped now) fall inside the
# 60-minute cluster window, exactly as they would against live data.
DEMO_NOW = datetime.now(timezone.utc)

DEMO_REPORTS: list[RawReport] = [
    make_report(
        id="D-FLOOD-1", event_type="flood", lat=47.6600, lon=9.1760,
        timestamp=DEMO_NOW,
    ),
    make_report(
        id="D-FLOOD-2",
        event_type="flood",
        lat=47.6608,
        lon=9.1750,
        text="Pegel steigt an der Seestraße",
        timestamp=DEMO_NOW + timedelta(minutes=10),  # same cluster as D-FLOOD-1
    ),
    make_report(
        id="D-FIRE-1", event_type="fire", lat=47.6620, lon=9.1748,
        text="Rauchsäule über der Altstadt", timestamp=DEMO_NOW,
    ),
    make_report(
        id="D-STORM-1", event_type="storm", lat=47.6700, lon=9.1900,
        text="Sturmböen werfen Äste auf die Mainaustraße", timestamp=DEMO_NOW,
    ),
    make_report(
        id="D-POWER-1", event_type="power_outage", lat=47.6550, lon=9.1850,
        text="Stromausfall in Petershausen-Ost", timestamp=DEMO_NOW,
    ),
    make_report(  # bot-spam hoax -> debunked by the heuristic layer
        id="D-HOAX-1", event_type="flood", lat=47.6580, lon=9.1700,
        text="BREAKING!!! Staudamm gebrochen! SHARE BEFORE THEY DELETE THIS!!!",
        timestamp=DEMO_NOW,
    ),
]


def _seed_state(reports: list[RawReport] = DEMO_REPORTS) -> None:
    """Seed the in-memory API state from an explicit report set. Test-only:
    production assembles the same state from the live ingestion snapshot."""
    _dispatch_registry.clear()
    credible, debunked = filter_reports(reports)
    state["credible"] = credible
    state["debunked"] = debunked
    state["incidents"] = _apply_dispatch_state(cluster_reports(credible))
    state["live_seq"] = 0


# --- Heuristic layer ------------------------------------------------------------


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


def test_full_pipeline_conserves_reports_and_surfaces_event_types() -> None:
    """Pipeline invariants: nothing is lost (every report becomes a clustered
    source or a debunk), hoaxes are caught, and distinct event types cluster
    independently."""
    result = run_pipeline(DEMO_REPORTS)
    assert len(result["debunked"]) > 0
    credible_count = sum(i.report_count for i in result["incidents"])
    assert credible_count + len(result["debunked"]) == len(DEMO_REPORTS)
    assert {"flood", "fire", "storm", "power_outage"} <= {
        i.event_type for i in result["incidents"]
    }


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
    result = run_pipeline(DEMO_REPORTS)
    flood = next(i for i in result["incidents"] if i.event_type == "flood")
    assert flood.severity == "high"
    assert flood.action_hint and "Low corroboration" not in flood.action_hint
    assert len(flood.sources) == flood.report_count
    # chronological source timeline
    stamps = [s.timestamp for s in flood.sources]
    assert stamps == sorted(stamps)


def test_single_source_incident_gets_low_corroboration_hint() -> None:
    (outage,) = cluster_reports([make_report(event_type="power_outage")])
    assert outage.report_count == 1
    assert outage.action_hint.startswith("Low corroboration")


# --- AI-generation filters (text leaks + C2PA-flagged media) ----------------------


def test_ai_generated_text_is_flagged() -> None:
    report = make_report(
        text="As an AI, I cannot fulfill this request — but here is a flood alert."
    )
    assessment = assess_report(report)
    assert not assessment.credible
    assert assessment.reason == "Linguistic: AI-Generated Text Leak"


def test_ai_generated_media_is_flagged() -> None:
    report = make_report(media_url="https://img.example/flut_deepfake_v2.jpg")
    assessment = assess_report(report)
    assert not assessment.credible
    assert assessment.reason == "Linguistic: AI-Generated Media (C2PA Flagged)"


def test_synthetic_media_in_live_media_list_is_flagged() -> None:
    report = make_report(
        media=[{"url": "https://cdn.example/synthetic_fire.png", "type": "image"}]
    )
    assert not assess_report(report).credible


# --- SOP checklists, classification + dispatch ------------------------------------


def test_incident_carries_sop_checklist() -> None:
    reports = [
        make_report(id=f"F{i}", event_type="fire", timestamp=NOW + timedelta(minutes=i))
        for i in range(3)
    ]
    (incident,) = cluster_reports(reports)
    tasks = {(t.task, t.agency) for t in incident.sop_tasks}
    assert ("Establish 300 m cordon", "Polizei") in tasks
    assert all(not t.completed for t in incident.sop_tasks)


def test_low_corroboration_prepends_recon_task() -> None:
    (incident,) = cluster_reports([make_report(event_type="storm")])
    assert incident.sop_tasks[0].task == "Task recon for ground truth verification"
    assert incident.sop_tasks[0].agency == "LRA"


def test_every_event_class_has_sop_tasks() -> None:
    from logic.guidance import KNOWN_EVENT_TYPES, sop_tasks_for

    agencies = {"Polizei", "Feuerwehr", "THW", "Rettungsdienst", "LRA"}
    for event_type in KNOWN_EVENT_TYPES:
        tasks = sop_tasks_for(event_type, 3, 0.9)
        assert tasks, event_type
        assert {t.agency for t in tasks} <= agencies, event_type


def test_security_sensitive_incident_is_classified() -> None:
    (terror,) = cluster_reports([make_report(event_type="terror_attack")])
    assert terror.classified
    (flood,) = cluster_reports([make_report(event_type="flood")])
    assert not flood.classified


def test_high_severity_high_confidence_auto_dispatches() -> None:
    from main import _apply_dispatch_state, _dispatch_registry

    _dispatch_registry.clear()
    reports = [
        make_report(id=f"F{i}", event_type="fire", timestamp=NOW + timedelta(minutes=i))
        for i in range(3)  # confidence 0.86 >= 0.85 threshold
    ]
    (incident,) = _apply_dispatch_state(cluster_reports(reports))
    assert incident.dispatched
    assert incident.dispatched_at is not None
    # Auto-alert hands off but does not work the checklist.
    assert all(not t.completed for t in incident.sop_tasks)
    # Sticky across re-clustering, timestamp preserved (no duplicate alert).
    (again,) = _apply_dispatch_state(cluster_reports(reports))
    assert again.dispatched_at == incident.dispatched_at
    _dispatch_registry.clear()


def test_moderate_severity_never_auto_dispatches() -> None:
    from main import _apply_dispatch_state, _dispatch_registry

    _dispatch_registry.clear()
    reports = [
        make_report(id=f"S{i}", event_type="storm", timestamp=NOW + timedelta(minutes=i))
        for i in range(4)
    ]
    (incident,) = _apply_dispatch_state(cluster_reports(reports))
    assert not incident.dispatched


def test_manual_dispatch_completes_checklist_and_persists() -> None:
    from main import dispatch_incident

    _seed_state()
    target = next(i for i in state["incidents"] if not i.dispatched)
    updated = dispatch_incident(target.id)
    assert updated.dispatched
    assert updated.dispatched_at is not None
    assert updated.sop_tasks and all(t.completed for t in updated.sop_tasks)
    served = next(i for i in state["incidents"] if i.id == target.id)
    assert served.dispatched  # visible to the next GET /api/incidents


def test_dispatch_unknown_incident_raises_404() -> None:
    from fastapi import HTTPException

    from main import dispatch_incident

    _seed_state()
    with pytest.raises(HTTPException) as excinfo:
        dispatch_incident("INC-999")
    assert excinfo.value.status_code == 404


# --- Live injection (POST /api/reports) ------------------------------------------


def test_inject_corroborating_flood_merges() -> None:
    _seed_state()
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
    _seed_state()
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
    _seed_state()
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
    _seed_state()
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
