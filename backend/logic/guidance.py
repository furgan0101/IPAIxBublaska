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

from schemas import SOPTask

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

# Itemized SOP checklists per event class — the actionable counterpart of the
# narrative _HINTS above. Agencies use the standard BW responder set:
# Polizei, Feuerwehr, THW, Rettungsdienst, LRA (Landratsamt crisis staff).
_SOP_TASKS: dict[str, list[dict[str, str]]] = {
    # Natural hazards
    "flood": [
        {"task": "Close affected waterfront paths", "agency": "Polizei"},
        {"task": "Deploy pumping crews", "agency": "Feuerwehr"},
        {"task": "Monitor lake level gauge", "agency": "LRA"},
    ],
    "storm": [
        {"task": "Clear fallen trees and debris from priority routes", "agency": "Feuerwehr"},
        {"task": "Cordon off areas with falling-debris risk", "agency": "Polizei"},
        {"task": "Issue public warning about falling trees", "agency": "LRA"},
    ],
    "wildfire": [
        {"task": "Map wind direction and projected fire spread", "agency": "Feuerwehr"},
        {"task": "Prepare evacuation of downwind settlements", "agency": "LRA"},
        {"task": "Close forest access roads", "agency": "Polizei"},
    ],
    "earthquake": [
        {"task": "Start building-damage triage", "agency": "Feuerwehr"},
        {"task": "Stage USAR teams near affected structures", "agency": "THW"},
        {"task": "Issue aftershock warning", "agency": "LRA"},
    ],
    "heatwave": [
        {"task": "Open cooling centres", "agency": "LRA"},
        {"task": "Check on vulnerable residents", "agency": "Rettungsdienst"},
        {"task": "Issue hydration advisories", "agency": "LRA"},
    ],
    "cold_spell": [
        {"task": "Open warming shelters", "agency": "LRA"},
        {"task": "Prioritise outreach to homeless and elderly", "agency": "Rettungsdienst"},
        {"task": "Monitor road ice on priority routes", "agency": "LRA"},
    ],
    # Technological / industrial
    "fire": [
        {"task": "Confirm fire-brigade dispatch", "agency": "Feuerwehr"},
        {"task": "Establish 300 m cordon", "agency": "Polizei"},
        {"task": "Reroute pedestrian/car traffic", "agency": "Polizei"},
    ],
    "explosion": [
        {"task": "Stage EOD assessment before entry", "agency": "Polizei"},
        {"task": "Establish medical triage zone", "agency": "Rettungsdienst"},
        {"task": "Secure perimeter against secondary incidents", "agency": "Feuerwehr"},
    ],
    "chemical_accident": [
        {"task": "Establish exclusion zone upwind", "agency": "Feuerwehr"},
        {"task": "Issue shelter-in-place advisory for adjacent blocks", "agency": "LRA"},
        {"task": "Cordon access roads to the site", "agency": "Polizei"},
    ],
    "hazmat": [
        {"task": "Identify substance via placards/ERICards", "agency": "Feuerwehr"},
        {"task": "Deploy measuring units downwind", "agency": "Feuerwehr"},
        {"task": "Cordon the release site", "agency": "Polizei"},
    ],
    "accident": [
        {"task": "Verify emergency services are on scene", "agency": "Rettungsdienst"},
        {"task": "Establish corridor control for responders", "agency": "Polizei"},
        {"task": "Reroute traffic around the site", "agency": "Polizei"},
    ],
    "infrastructure_failure": [
        {"task": "Identify affected lifeline systems", "agency": "LRA"},
        {"task": "Activate redundancy and emergency-power plans", "agency": "THW"},
        {"task": "Inform the operators' crisis cells", "agency": "LRA"},
    ],
    # CBRN
    "nuclear_accident": [
        {"task": "Verify plume model against measuring data", "agency": "LRA"},
        {"task": "Prepare iodine tablet distribution", "agency": "Rettungsdienst"},
        {"task": "Draft sheltering order for affected sectors", "agency": "LRA"},
    ],
    "radiological": [
        {"task": "Deploy radiation measuring teams", "agency": "Feuerwehr"},
        {"task": "Cordon the contaminated area", "agency": "Polizei"},
        {"task": "Register potentially exposed persons", "agency": "Rettungsdienst"},
    ],
    "biological": [
        {"task": "Isolate the exposure site", "agency": "Polizei"},
        {"task": "Alert the public-health authority", "agency": "LRA"},
        {"task": "Secure samples for laboratory analysis", "agency": "Feuerwehr"},
    ],
    "chemical_attack": [
        {"task": "Establish decontamination corridor", "agency": "Feuerwehr"},
        {"task": "Stage antidote stocks at triage point", "agency": "Rettungsdienst"},
        {"task": "Secure crime scene strictly upwind", "agency": "Polizei"},
    ],
    # Public health
    "pandemic": [
        {"task": "Activate the public-health crisis team", "agency": "LRA"},
        {"task": "Scale testing and treatment capacity", "agency": "Rettungsdienst"},
        {"task": "Issue protective guidance to the public", "agency": "LRA"},
    ],
    # Terrorism / security
    "terror_attack": [
        {"task": "Alert tactical command units", "agency": "Polizei"},
        {"task": "Establish medical triage zone", "agency": "Rettungsdienst"},
        {"task": "Enforce strict media blackout", "agency": "Polizei"},
    ],
    "cbrn_attack": [
        {"task": "Deploy specialist CBRN units", "agency": "Feuerwehr"},
        {"task": "Establish wide outer cordon", "agency": "Polizei"},
        {"task": "Enforce strict information discipline", "agency": "Polizei"},
    ],
    "hostage": [
        {"task": "Alert negotiation and tactical units", "agency": "Polizei"},
        {"task": "Route all public communication via police press office", "agency": "Polizei"},
        {"task": "Stage ambulances at safe distance", "agency": "Rettungsdienst"},
    ],
    "sabotage": [
        {"task": "Secure the affected infrastructure", "agency": "Polizei"},
        {"task": "Preserve evidence for investigators", "agency": "Polizei"},
        {"task": "Raise protection level on comparable sites", "agency": "LRA"},
    ],
    # Supply / infrastructure crises
    "power_outage": [
        {"task": "Notify the grid operator's fault desk", "agency": "LRA"},
        {"task": "Check critical infrastructure on backup power", "agency": "THW"},
        {"task": "Monitor traffic signals at key junctions", "agency": "Polizei"},
    ],
    "telecom_failure": [
        {"task": "Activate sirens/radio/loudspeaker alerting channels", "agency": "LRA"},
        {"task": "Establish relay communications", "agency": "THW"},
        {"task": "Staff fire stations as emergency call points", "agency": "Feuerwehr"},
    ],
    "water_supply": [
        {"task": "Set up emergency water distribution points", "agency": "THW"},
        {"task": "Issue boil-water advisory", "agency": "LRA"},
        {"task": "Prioritise hospitals and care facilities", "agency": "LRA"},
    ],
    "food_supply": [
        {"task": "Activate the emergency supply concept", "agency": "LRA"},
        {"task": "Coordinate distribution with retailers and aid organisations", "agency": "LRA"},
        {"task": "Provide logistics and transport support", "agency": "THW"},
    ],
    "supply_chain": [
        {"task": "Prioritise critical deliveries (medical, fuel, food)", "agency": "LRA"},
        {"task": "Document shortages for state-level escalation", "agency": "LRA"},
        {"task": "Provide transport and logistics support", "agency": "THW"},
    ],
    # Civil defence operations
    "evacuation": [
        {"task": "Publish assembly points and routes", "agency": "LRA"},
        {"task": "Arrange transport for non-mobile residents", "agency": "Rettungsdienst"},
        {"task": "Secure the evacuated area", "agency": "Polizei"},
    ],
}
_DEFAULT_SOP_TASKS: list[dict[str, str]] = [
    {"task": "Dispatch reconnaissance to verify conditions on the ground", "agency": "LRA"},
    {"task": "Update the sector log", "agency": "LRA"},
]
_RECON_TASK: dict[str, str] = {
    "task": "Task recon for ground truth verification",
    "agency": "LRA",
}

#: Canonical event taxonomy (BW Ministry of the Interior crisis catalogue).
KNOWN_EVENT_TYPES: tuple[str, ...] = tuple(_HINTS.keys())

#: Security-sensitive classes whose raw intelligence must not reach the public
#: feed (information discipline / Police Command handoff).
SECURITY_SENSITIVE_TYPES: frozenset[str] = frozenset(
    {"terror_attack", "hostage", "cbrn_attack"}
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
    
    # Specific demo requirement: Mannheim fire mobility service for elderly
    if event_type == "fire" and confidence >= 0.8:
        return f"{base} Provide mobility services for the evacuation of elderly and non-mobile people."

    return base


def sop_tasks_for(
    event_type: str, report_count: int, confidence: float
) -> list[SOPTask]:
    """Itemized SOP checklist for a verified incident (fresh, mutable copies).

    Low-corroboration incidents get a reconnaissance triage task prepended —
    ground truth before resources, mirroring `action_hint`."""
    template = _SOP_TASKS.get(event_type, _DEFAULT_SOP_TASKS)
    tasks = [SOPTask(**item) for item in template]
    if report_count < 2 or confidence < LOW_CORROBORATION_CONFIDENCE:
        tasks.insert(0, SOPTask(**_RECON_TASK))
    return tasks


def is_security_sensitive(event_type: str) -> bool:
    """Information discipline applies: high-impact security classes whose raw
    intelligence (media, source feeds) must be restricted to prevent panic and
    protect police tactics."""
    return (
        event_type in SECURITY_SENSITIVE_TYPES and severity_for(event_type) == "high"
    )
