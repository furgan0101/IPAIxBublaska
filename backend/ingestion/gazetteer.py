"""Offline gazetteer for the Konstanz demo sector (zero network calls).

Maps place names appearing in raw report text to approximate centroids —
good enough to drop a pin in the right town/district. Street-level precision
is the job of the optional Nominatim fallback (ingestion.geocode). Covers the
city districts of Konstanz, every municipality of Landkreis Konstanz, the
Swiss shore opposite, and the neighbouring district towns that appear in
Polizeipräsidium Konstanz press releases (those beyond the sector radius are
geocoded correctly and then dropped by the sector filter).
"""
from __future__ import annotations

import re

#: name (lowercase) -> (lat, lon). Approximate town/district centroids.
PLACES: dict[str, tuple[float, float]] = {
    # Konstanz city + districts
    "konstanz": (47.6603, 9.1758),
    "petershausen": (47.6680, 9.1786),
    "wollmatingen": (47.6717, 9.1543),
    "allmannsdorf": (47.6707, 9.1955),
    "staad": (47.6738, 9.2030),
    "litzelstetten": (47.6960, 9.1934),
    "dingelsdorf": (47.7152, 9.1958),
    "dettingen": (47.7126, 9.1547),
    "niederburg": (47.6645, 9.1752),
    "paradies": (47.6571, 9.1690),
    "fürstenberg": (47.6740, 9.1690),
    "mainau": (47.7053, 9.1953),
    # Landkreis Konstanz municipalities
    "reichenau": (47.6920, 9.0620),
    "allensbach": (47.7167, 9.0667),
    "radolfzell": (47.7372, 8.9710),
    "singen": (47.7623, 8.8400),
    "rielasingen": (47.7286, 8.8404),
    "worblingen": (47.7253, 8.8550),
    "gottmadingen": (47.7355, 8.7768),
    "hilzingen": (47.7679, 8.7813),
    "gailingen": (47.6969, 8.7552),
    "büsingen": (47.6967, 8.6900),
    "öhningen": (47.6631, 8.8852),
    "moos": (47.7231, 8.9352),
    "gaienhofen": (47.6833, 8.9850),
    "steißlingen": (47.8000, 8.9333),
    "stockach": (47.8510, 9.0090),
    "bodman": (47.8186, 9.0420),
    "ludwigshafen": (47.8167, 9.0606),
    "orsingen": (47.8389, 8.9352),
    "nenzingen": (47.8420, 8.9650),
    "eigeltingen": (47.8533, 8.9000),
    "aach": (47.8430, 8.8520),
    "volkertshausen": (47.8122, 8.8702),
    "mühlhausen-ehingen": (47.7890, 8.8230),
    "engen": (47.8570, 8.7720),
    "tengen": (47.8210, 8.6620),
    "hohenfels": (47.8970, 9.1180),
    # Swiss shore / immediate neighbours
    "kreuzlingen": (47.6458, 9.1750),
    "tägerwilen": (47.6560, 9.1380),
    "ermatingen": (47.6700, 9.0860),
    "steckborn": (47.6670, 8.9830),
    "stein am rhein": (47.6592, 8.8600),
    "schaffhausen": (47.6957, 8.6340),
    # Bodensee towns on the northern shore
    "meersburg": (47.6939, 9.2700),
    "uhldingen": (47.7269, 9.2250),
    "überlingen": (47.7681, 9.1650),
    "markdorf": (47.7200, 9.3910),
    "friedrichshafen": (47.6542, 9.4795),
    # Neighbouring districts covered by Polizeipräsidium Konstanz
    "tuttlingen": (47.9847, 8.8233),
    "spaichingen": (47.9750, 8.7370),
    "trossingen": (48.0760, 8.6440),
    "rottweil": (48.1680, 8.6270),
    "villingen-schwenningen": (48.0600, 8.4900),
    "villingen": (48.0610, 8.4580),
    "schwenningen": (48.0570, 8.5350),
    "donaueschingen": (47.9530, 8.4970),
}

# Longest names first so "stein am rhein" wins over a hypothetical "rhein".
_PATTERN: re.Pattern[str] = re.compile(
    "|".join(
        rf"\b{re.escape(name)}\b"
        for name in sorted(PLACES, key=len, reverse=True)
    ),
    re.IGNORECASE,
)


def find(text: str) -> tuple[float, float] | None:
    """Coordinates of the first known place named in `text`, else None."""
    match = _PATTERN.search(text)
    if match is None:
        return None
    return PLACES[match.group(0).lower()]
