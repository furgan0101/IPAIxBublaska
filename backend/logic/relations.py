"""AI Relation Engine: LLM-based causal and semantic link detection between incidents.

Compares incident summaries to identify if they are part of a larger chain
(e.g., 'Fire' -> 'Evacuation' or 'Storm' -> 'Power Outage').
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

from pydantic import BaseModel, Field, ValidationError

from logic.verification import _chat_completion, live_mode_enabled
from schemas import RelatedIncident, VerifiedIncident

logger = logging.getLogger("vost.relations")

RELATION_PROMPT: str = (
    "You are an expert crisis situational awareness analyst. Compare two incident summaries "
    "to determine if they are related through causality or shared consequences. "
    "Incident A: {summary_a} ({type_a}) "
    "Incident B: {summary_b} ({type_b}) "
    "Determine if B is a direct consequence of A (e.g., a Fire causing an Evacuation) "
    "or if they share a direct causal link. "
    "relation_type must be: "
    "- 'causal': B was caused by A. "
    "- 'sequel': B is a direct follow-up or evolution of A. "
    "- 'spatial': They share a location and are likely related by context, even if not direct. "
    "- 'none': No clear relationship. "
    "Output ONLY raw JSON, exactly these keys: "
    '{{"relation_type": string, "confidence": number, "rationale": string}}. '
    "confidence is 0.0 to 1.0. rationale is one concise English sentence."
)

class RelationVerdict(BaseModel):
    relation_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str

async def assess_relation(
    incident_a: VerifiedIncident, incident_b: VerifiedIncident
) -> RelationVerdict | None:
    """Ask the LLM if two incidents are linked."""
    if not live_mode_enabled():
        return None

    prompt = RELATION_PROMPT.format(
        summary_a=incident_a.summary,
        type_a=incident_a.event_type,
        summary_b=incident_b.summary,
        type_b=incident_b.event_type,
    )

    try:
        # Re-using the chat completion helper from verification.py
        raw = _chat_completion([{"role": "user", "content": prompt}])
        # Strip potential code fences
        from logic.verification import _strip_code_fences
        data = json.loads(_strip_code_fences(raw))
        verdict = RelationVerdict.model_validate(data)
        if verdict.relation_type == "none" or verdict.confidence < 0.7:
            return None
        return verdict
    except (Exception, ValidationError):
        return None

async def find_relations(
    target: VerifiedIncident, candidates: Sequence[VerifiedIncident]
) -> list[RelatedIncident]:
    """Compare a target incident against a list of candidates to find links."""
    relations: list[RelatedIncident] = []
    
    # Heuristic pre-filter: same city/region and within 12 hours
    cutoff = target.first_seen - timedelta(hours=12)
    
    for candidate in candidates:
        if candidate.id == target.id:
            continue
            
        # Basic spatio-temporal filter to save on LLM tokens
        time_diff = abs((target.first_seen - candidate.first_seen).total_seconds())
        if time_diff > 43200: # 12 hours
            continue
            
        # We don't have a 'city' field on VerifiedIncident yet, but we can 
        # use a rough distance check or simply rely on the LLM if they are in the 'same scenario'
        from geopy.distance import geodesic
        dist = geodesic((target.lat, target.lon), (candidate.lat, candidate.lon)).kilometers
        if dist > 15.0: # 15km radius for related events
            continue

        verdict = await assess_relation(candidate, target)
        if verdict:
            relations.append(
                RelatedIncident(
                    incident_id=candidate.id,
                    relation_type=verdict.relation_type,
                    rationale=verdict.rationale,
                )
            )
            
    return relations
