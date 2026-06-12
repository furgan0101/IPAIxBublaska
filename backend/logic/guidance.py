"""Responder guidance: severity grading + concise action hints per incident.

The event taxonomy mirrors the potential crisis scenarios addressed by the
Ministry of the Interior of Baden-Württemberg: natural hazards, technological
and industrial disasters, CBRN incidents, pandemics, terrorism and security
threats, supply and infrastructure crises, and civil-defence operations
(evacuations). Preparedness *measures* from the catalogue (e.g. cooperation
with federal authorities) are not incident types and are intentionally absent.

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
    # Natural hazards
    "flood": "high",
    "storm": "moderate",
    "wildfire": "high",
    "earthquake": "high",
    "heatwave": "moderate",
    "cold_spell": "moderate",
    # Technological / industrial
    "fire": "high",
    "explosion": "high",
    "chemical_accident": "high",
    "hazmat": "high",
    "accident": "high",  # large-scale transport accident (road/rail/air/water)
    "infrastructure_failure": "moderate",
    # CBRN
    "nuclear_accident": "high",
    "radiological": "high",
    "biological": "high",
    "chemical_attack": "high",
    # Public health
    "pandemic": "high",
    # Terrorism / security
    "terror_attack": "high",
    "cbrn_attack": "high",
    "hostage": "high",
    "sabotage": "moderate",
    # Supply / infrastructure crises
    "power_outage": "moderate",
    "telecom_failure": "moderate",
    "water_supply": "moderate",
    "food_supply": "moderate",
    "supply_chain": "moderate",
    # Civil defence operations
    "evacuation": "moderate",
}

_HINTS: dict[str, str] = {
    # Natural hazards
    "flood": (
        "Close affected waterfront paths, deploy pumping crews and monitor "
        "the lake level gauge."
    ),
    "storm": (
        "Warn of falling trees and debris; prioritise road-clearance crews "
        "on the affected routes."
    ),
    "wildfire": (
        "Alert forestry and fire services, map wind direction and prepare "
        "evacuation of downwind settlements."
    ),
    "earthquake": (
        "Start building-damage triage, warn of aftershocks and stage USAR "
        "teams near affected structures."
    ),
    "heatwave": (
        "Activate the heat action plan: open cooling centres, check on "
        "vulnerable residents, issue hydration advisories."
    ),
    "cold_spell": (
        "Open warming shelters, prioritise outreach to homeless and elderly, "
        "monitor road ice and grid load."
    ),
    # Technological / industrial
    "fire": (
        "Confirm fire-brigade dispatch, establish a 300 m cordon and reroute "
        "pedestrian traffic."
    ),
    "explosion": (
        "Stage EOD assessment before entry, triage casualties and secure the "
        "perimeter against secondary incidents."
    ),
    "chemical_accident": (
        "Establish an exclusion zone upwind, alert hazmat units and advise "
        "shelter-in-place for adjacent blocks."
    ),
    "hazmat": (
        "Cordon the release site, identify the substance (placards/ERICards) "
        "and deploy measuring units downwind."
    ),
    "accident": (
        "Verify emergency services are on scene, establish corridor control "
        "and reroute traffic around the site."
    ),
    "infrastructure_failure": (
        "Identify affected lifeline systems, activate redundancy plans and "
        "inform the operators' crisis cells."
    ),
    # CBRN
    "nuclear_accident": (
        "Follow the radiological emergency plan: verify the plume model, "
        "prepare iodine distribution and sheltering orders."
    ),
    "radiological": (
        "Deploy radiation measuring teams, cordon the contaminated area and "
        "register potentially exposed persons."
    ),
    "biological": (
        "Isolate the exposure site, alert the public-health authority, trace "
        "contacts and secure samples for analysis."
    ),
    "chemical_attack": (
        "Treat as crime scene plus hazmat: decontamination corridor, antidote "
        "stocks, staging strictly upwind."
    ),
    # Public health
    "pandemic": (
        "Activate the public-health crisis team, scale testing and treatment "
        "capacity and issue protective guidance."
    ),
    # Terrorism / security
    "terror_attack": (
        "Police lead — support with the situational picture only; do NOT "
        "publish tactical details or force positions."
    ),
    "cbrn_attack": (
        "Maximum protective posture: specialist CBRN units lead, wide cordon, "
        "strict information discipline."
    ),
    "hostage": (
        "Information blackout on police tactics; route all public "
        "communication through the police press office."
    ),
    "sabotage": (
        "Secure the affected infrastructure, preserve evidence and raise the "
        "protection level on comparable sites."
    ),
    # Supply / infrastructure crises
    "power_outage": (
        "Notify the grid operator and check critical infrastructure on "
        "backup power."
    ),
    "telecom_failure": (
        "Activate alternative alerting channels (sirens, radio, loudspeaker "
        "vehicles) and establish relay communications."
    ),
    "water_supply": (
        "Coordinate emergency water distribution points and issue boil-water "
        "advisories where applicable."
    ),
    "food_supply": (
        "Activate the emergency supply concept and coordinate distribution "
        "with retailers and aid organisations."
    ),
    "supply_chain": (
        "Prioritise critical deliveries (medical, fuel, food), document "
        "shortages and escalate to state level."
    ),
    # Civil defence operations
    "evacuation": (
        "Publish assembly points and routes, arrange transport for "
        "non-mobile residents and track registration."
    ),
}
_DEFAULT_HINT: str = (
    "Dispatch reconnaissance to verify conditions on the ground and update "
    "the sector log."
)

#: Canonical event taxonomy (BW Ministry of the Interior crisis catalogue).
KNOWN_EVENT_TYPES: tuple[str, ...] = tuple(_HINTS.keys())

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
