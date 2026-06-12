"""Happy-path tests: schema parsing, credibility rules, 1 km clustering."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from logic.geospatial import cluster_reports
from logic.verification import assess_report
from main import load_raw_reports, run_pipeline
from schemas import RawReport

NOW = datetime(2026, 6, 12, 14, 0, tzinfo=timezone.utc)


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


def test_mock_data_matches_raw_report_schema() -> None:
    reports = load_raw_reports()
    assert len(reports) == 8


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
    assert len(result["debunked"]) == 3
    assert sum(i.report_count for i in result["incidents"]) == 5
    assert {i.event_type for i in result["incidents"]} == {"flood", "fire"}
