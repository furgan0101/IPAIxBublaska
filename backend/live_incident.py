"""Build the Mannheim-Rheinau industrial-fire scenario from `data/live.json`.

This is the demo's centrepiece feed. `data/live.json` is a richer, messier
OSINT capture (200 posts over 24 h, mixed languages, mostly imprecise
locations) than the synthetic `mock_data.json`. Rather than force its 200
loosely-located posts through the 1 km / 60 min clusterer — which is tuned for
tight sector bursts and would shatter a city-wide, day-long event — we read the
capture's own `incident` definition and group its posts by reported
`incident_type` into one primary fire incident plus its cascading secondary
incidents (air quality, evacuation, motorway closure, Rhine contamination).

Everything is emitted as the same `VerifiedIncident` schema the rest of the
pipeline produces, so the API and dashboard consume it with zero special
casing. Fully offline. The file is gitignored, so loading is best-effort: if it
is absent the snapshot is simply empty and the rest of the pipeline is
unaffected.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import fmean
from typing import Any

from logic.guidance import action_hint, severity_for
from schemas import RelatedIncident, SourceReport, VerifiedIncident

LIVE_FILE: Path = Path(__file__).parent / "data" / "live.json"

# How many posts to surface in each incident's source timeline (highest
# reliability first, then shown chronologically). The full corroboration count
# is preserved in `report_count`.
_MAX_SOURCES: int = 50


class _Group:
    """One emitted incident: which raw `incident_type`s feed it, the event
    class it maps to, a fixed anchor near the fire (keeps the pins a tight,
    legible Mannheim cluster instead of drifting to outlier post coords), and
    its human summary."""

    def __init__(
        self,
        incident_id: str,
        event_type: str,
        raw_types: set[str],
        anchor: tuple[float, float],
        summary: str,
    ) -> None:
        self.incident_id = incident_id
        self.event_type = event_type
        self.raw_types = raw_types
        self.anchor = anchor
        self.summary = summary


# Primary fire first; secondaries are the cascading consequences the capture
# documents via its `secondary_events`. `medical`, `other` and `infrastructure`
# posts are context for the fire dossier, not their own pins.
_GROUPS: tuple[_Group, ...] = (
    _Group(
        "INC-MH-FIRE",
        "fire",
        {"fire"},
        (49.534767, 8.461813),
        "Major industrial fire in Mannheim-Waldhof (Sandhofer Str. 174) with a "
        "large-scale fire response. Cascading effects: school closures, "
        "respiratory hospital admissions, an air-quality alert, evacuation of "
        "residential area, and potential Rhine contamination from firefighting "
        "runoff.",
    ),
    _Group(
        "INC-MH-AIR",
        "hazmat",
        {"air_quality"},
        (49.5407, 8.4558),
        "Air-quality alert downwind of the Mannheim-Waldhof fire — residents "
        "report heavy smoke and odour; the city advises keeping windows shut.",
    ),
    _Group(
        "INC-MH-EVAC",
        "evacuation",
        {"evacuation"},
        (49.5287, 8.4698),
        "Precautionary evacuations plus school and Kita closures around the "
        "Mannheim-Waldhof fire.",
    ),
    _Group(
        "INC-MH-A6",
        "accident",
        {"traffic"},
        (49.5607, 8.4988),
        "A6 motorway closed near Mannheim-Sandhofen due to smoke drift; "
        "kilometre-long tailbacks.",
    ),
    _Group(
        "INC-MH-WATER",
        "water_supply",
        {"water_contamination"},
        (49.534303, 8.454597),
        "Environmental agency warns firefighting runoff could contaminate the "
        "Rhine near Mannheim-Waldhof.",
    ),
)


def _confidence(posts: list[dict[str, Any]]) -> float:
    """Trust score for the cluster: blends mean source reliability, the
    presence of a high-reliability official source, and corroboration volume.
    Bounded to [0.5, 0.97] like the geo-clusterer's confidence."""
    mean_rel = fmean(p["reliability_score"] for p in posts) / 100.0
    has_official = any(p["reliability_score"] >= 85 for p in posts)
    volume_bonus = min(0.10, 0.005 * len(posts))
    raw = 0.40 + 0.45 * mean_rel + (0.10 if has_official else 0.0) + volume_bonus
    return round(min(max(raw, 0.50), 0.97), 2)


def _source_report(post: dict[str, Any]) -> SourceReport:
    author = post.get("author") or {}
    return SourceReport(
        id=post["id"],
        source=post.get("source", "live"),
        author=author.get("display_name") or author.get("handle") or "unknown",
        text=post["text"],
        timestamp=post["_ts"],  # rebased datetime, attached below
        url=post.get("url"),
        # live.json media URLs are placeholders (media.example/*) — omit them
        # so the dossier never fires requests at a non-existent host.
        media_preview=None,
        ai_credibility=round(post["reliability_score"] / 100.0, 2),
    )


def _build_incident(
    group: _Group, posts: list[dict[str, Any]], related: list[RelatedIncident] | None = None
) -> VerifiedIncident:
    ordered = sorted(posts, key=lambda p: p["_ts"])
    # Most reliable posts make the timeline; shown chronologically.
    top = sorted(posts, key=lambda p: p["reliability_score"], reverse=True)[:_MAX_SOURCES]
    top_chrono = sorted(top, key=lambda p: p["_ts"])
    confidence = _confidence(posts)
    return VerifiedIncident(
        id=group.incident_id,
        event_type=group.event_type,
        lat=group.anchor[0],
        lon=group.anchor[1],
        confidence_score=confidence,
        ai_credibility=round(fmean(p["reliability_score"] for p in posts) / 100.0, 2),
        source_ids=[p["id"] for p in ordered],
        report_count=len(posts),
        first_seen=ordered[0]["_ts"],
        last_seen=ordered[-1]["_ts"],
        summary=group.summary,
        severity=severity_for(group.event_type),
        action_hint=action_hint(group.event_type, len(posts), confidence),
        sources=[_source_report(p) for p in top_chrono],
        related_incidents=related or [],
    )


def build_live_incidents(now: datetime | None = None) -> list[VerifiedIncident]:
    """Parse `data/live.json` into the Mannheim incident cluster, with post
    timestamps rebased so the newest sits at `now`. Returns an empty list if
    the (gitignored) capture file is absent or malformed."""
    if now is None:
        now = datetime.now(timezone.utc)
    try:
        payload = json.loads(LIVE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return []

    posts: list[dict[str, Any]] = payload.get("posts", [])
    if not posts:
        return []

    # Rebase every post so the latest capture timestamp == now (deltas kept).
    parsed: list[dict[str, Any]] = []
    for post in posts:
        try:
            ts = datetime.fromisoformat(post["timestamp"])
        except (KeyError, ValueError):
            continue
        post["_parsed_ts"] = ts
        parsed.append(post)
    if not parsed:
        return []
    shift = now - max(p["_parsed_ts"] for p in parsed)
    for post in parsed:
        post["_ts"] = post["_parsed_ts"] + shift

    incidents: list[VerifiedIncident] = []
    for group in _GROUPS:
        members = [p for p in parsed if p.get("incident_type") in group.raw_types]
        if not members:
            continue
            
        related: list[RelatedIncident] = []
        if group.incident_id == "INC-MH-FIRE":
            related.append(RelatedIncident(
                incident_id="INC-MH-EVAC",
                relation_type="causal",
                rationale="The escalating industrial fire prompts immediate evacuations in nearby zones, causes hazmat release, and the fire brigade works induces water pollution."
            ))
        elif group.incident_id == "INC-MH-AIR":
            related.append(RelatedIncident(
                incident_id="INC-MH-FIRE",
                relation_type="causal",
                rationale="Toxic air quality warnings are driven directly by the major fire emissions."
            ))
        elif group.incident_id == "INC-MH-EVAC":
            related.append(RelatedIncident(
                incident_id="INC-MH-WATER",
                relation_type="causal",
                rationale="Evacuation zones are adjacent to water containment basins."
            ))
        elif group.incident_id == "INC-MH-WATER":
            related.append(RelatedIncident(
                incident_id="INC-MH-AIR",
                relation_type="causal",
                rationale="Chemical runoff in the water basins volatilizes, exacerbating local air contamination."
            ))
            
        incidents.append(_build_incident(group, members, related))
    return incidents
