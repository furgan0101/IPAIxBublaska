"""Responder guidance: severity grading + concise action hints per incident.

Pure, deterministic, fully offline — this is the "action hints" half of the
challenge's "situation overview with maps and action hints". If live AI is
enabled later, these can be swapped for model-generated guidance without
touching the clustering step.
"""
from __future__ import annotations

from typing import Literal

Severity = Literal["high", "moderate", "low"]

# Impact-based grading (certainty is expressed separately via confidence_score).
_SEVERITY_BY_TYPE: dict[str, Severity] = {
    "fire": "high",
    "flood": "high",
    "storm": "moderate",
    "power_outage": "moderate",
    "accident": "moderate",
}

_HINTS: dict[str, str] = {
    "flood": (
        "Close affected waterfront paths, deploy pumping crews and monitor "
        "the lake level gauge."
    ),
    "fire": (
        "Confirm fire-brigade dispatch, establish a 300 m cordon and reroute "
        "pedestrian traffic."
    ),
    "storm": (
        "Warn of falling trees and debris; prioritise road-clearance crews "
        "on the affected routes."
    ),
    "power_outage": (
        "Notify the grid operator and check critical infrastructure on "
        "backup power."
    ),
    "accident": (
        "Verify emergency services are on scene and manage traffic flow "
        "around the site."
    ),
}
_DEFAULT_HINT: str = (
    "Dispatch reconnaissance to verify conditions on the ground and update "
    "the sector log."
)

LOW_CORROBORATION_CONFIDENCE: float = 0.70


def severity_for(event_type: str) -> Severity:
    """Base severity grading by event class (impact, not certainty)."""
    return _SEVERITY_BY_TYPE.get(event_type, "low")


def action_hint(event_type: str, report_count: int, confidence: float) -> str:
    """Concise recommended responder action for a verified incident."""
    base = _HINTS.get(event_type, _DEFAULT_HINT)
    if report_count < 2 or confidence < LOW_CORROBORATION_CONFIDENCE:
        return (
            "Low corroboration — task recon for ground truth first. "
            f"If confirmed: {base[0].lower() + base[1:]}"
        )
    return base
