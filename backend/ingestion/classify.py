"""Deterministic event-type classifier for raw OSINT text (German + English).

Maps free text onto the BW crisis taxonomy (logic.guidance.KNOWN_EVENT_TYPES).
The first matching rule wins, so the order runs specific -> generic
("Waldbrand" before "Brand", "Chemieunfall" before "Unfall"). Returns None
when no crisis class matches — such reports are not crisis-relevant and are
dropped by the ingestion service before they ever reach the credibility
filter or the map. In live-AI mode the LLM analyst refines this initial
classification (verification.apply_event_type), exactly as for mock reports.
"""
from __future__ import annotations

import re

from logic.guidance import KNOWN_EVENT_TYPES

# (event_type, regex) — ordered most-specific first; case-insensitive.
_RULES_SPEC: tuple[tuple[str, str], ...] = (
    # CBRN (most specific compounds first)
    ("nuclear_accident", r"kernkraftwerk|atomkraftwerk|atomunfall|\bakw\b|nuclear (?:accident|plant)"),
    ("radiological", r"radioaktiv|strahlenalarm|strahlung ausgetreten|radiological|dirty bomb"),
    ("chemical_attack", r"giftgas|nervengift|chemiewaffe|chemical attack"),
    ("biological", r"\bseuche|milzbrand|biogefahr|biological hazard|anthrax"),
    ("pandemic", r"pandemie|epidemie|infektionswelle|pandemic|epidemic"),
    ("chemical_accident", r"chemieunfall|chemiest[öo]rfall|s[äa]ureaustritt|ammoniak|chlorgas|chemical (?:spill|accident)"),
    ("hazmat", r"gefahrgut|gefahrstoff|gasaustritt|gasleck|gasgeruch|[öo]laustritt|hazmat|gas leak"),
    # Terrorism / security
    ("terror_attack", r"\bterror|anschlag\b|amokl|\bamok\b|bombendrohung|sprengsatz|attentat|schie[ßs]s?erei|active shooter"),
    ("hostage", r"geisel|hostage"),
    ("sabotage", r"sabotage|brandanschlag|kabel durchtrennt|sabotiert"),
    # Civil defence (incl. WWII bomb disposal — the classic evacuation trigger)
    ("evacuation", r"evakuier|r[äa]umung|bombenfund|fliegerbombe|blindg[äa]nger|evacuat"),
    # Natural hazards
    ("wildfire", r"waldbrand|vegetationsbrand|fl[äa]chenbrand|wildfire|forest fire"),
    ("flood", r"hochwasser|[üu]berflut|[üu]berschwemm|sturmflut|land unter|dammbruch|deichbruch|pegel\w* steigt|keller\w* voll|vollgelaufene? keller|\bflood|geflutet|\bflut\b|unter wasser"),
    ("earthquake", r"erdbeben|earthquake|seismisch"),
    ("heatwave", r"hitzewelle|hitzewarnung|extreme hitze|heat ?wave"),
    ("cold_spell", r"k[äa]ltewelle|glatteis|blitzeis|eisregen|strenger frost|cold snap|black ice"),
    ("storm", r"\bsturm|orkan|unwetter|gewitter|\bhagel|starkregen|windb[öo]en?|tornado|umgest[üu]rzt|entwurzelt|baum.{0,60}(?:gest[üu]rzt|umgeworfen|blockiert)|b[äa]ume.{0,60}(?:gest[üu]rzt|umgeworfen)|\bb[öo]en\b|\bstorm\b|hurricane|blaulicht|rettungskr[äa]fte|\beinsatz\b"),
    # Technological / industrial
    ("explosion", r"explosion|explodiert|detonation|verpuffung"),
    ("fire", r"\bbrand|brand\b|brennt|brennen(?:des|der)?\b|dachstuhl|rauchentwicklung|rauchs[äa]ule|flammen|\bfeuer\b|giftwolke|\bfire\b|smoke (?:column|plume)|feuerwehreinsatz"),
    ("accident", r"verkehrsunfall|zugungl[üu]ck|zugkollision|flugzeugabsturz|massenkarambolage|zusammenstoß|zusammenstoss|\bunfall|unfall\b|karambolage|car crash|train crash|\baccident\b|schwerverletzt|leichtverletzt|\bverletzt\b"),
    # Supply / infrastructure crises
    ("power_outage", r"stromausfall|\bblackout\b|ohne strom|stromnetz\w* ausgefallen|power (?:outage|cut)"),
    ("telecom_failure", r"mobilfunkausfall|telefonnetz gest[öo]rt|notruf\w*\s+(?:gest[öo]rt|ausgefallen)|telecom failure"),
    ("water_supply", r"trinkwasser|wasserrohrbruch|rohrbruch|abkochgebot|wasserversorgung|boil.water advisory"),
    ("food_supply", r"lebensmittelknappheit|lebensmittelversorgung|food shortage"),
    ("supply_chain", r"lieferengpass|versorgungsengpass|kraftstoffknappheit|treibstoffmangel|hamsterk[äa]ufe|supply (?:chain disruption|shortage)"),
    ("infrastructure_failure", r"stellwerkst[öo]rung|oberleitungsschaden|br[üu]cke gesperrt|fernw[äa]rme|kritische infrastruktur|infrastructure failure"),
)

# Constrain to the canonical taxonomy so a rule typo can never invent a class.
_RULES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (event_type, re.compile(pattern, re.IGNORECASE))
    for event_type, pattern in _RULES_SPEC
    if event_type in KNOWN_EVENT_TYPES
)


def classify(text: str) -> str | None:
    """First matching crisis class for `text`, or None (not crisis-relevant)."""
    for event_type, pattern in _RULES:
        if pattern.search(text):
            return event_type
    return None
