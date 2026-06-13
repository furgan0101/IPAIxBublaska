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
    # --- Baden-Württemberg statewide (Stadtkreise + Kreis seats + major
    # towns), so live feeds beyond the Bodensee sector still pin correctly. ---
    # Region Stuttgart
    "stuttgart": (48.7758, 9.1829),
    "esslingen": (48.7406, 9.3100),
    "nürtingen": (48.6260, 9.3420),
    "ludwigsburg": (48.8974, 9.1916),
    "bietigheim-bissingen": (48.9540, 9.1280),
    "waiblingen": (48.8303, 9.3170),
    "fellbach": (48.8090, 9.2760),
    "schorndorf": (48.8050, 9.5270),
    "backnang": (48.9460, 9.4290),
    "böblingen": (48.6850, 9.0110),
    "sindelfingen": (48.7130, 9.0030),
    "leonberg": (48.8000, 9.0150),
    "göppingen": (48.7036, 9.6527),
    "heilbronn": (49.1427, 9.2109),
    "schwäbisch hall": (49.1127, 9.7380),
    "öhringen": (49.1990, 9.5030),
    "crailsheim": (49.1350, 10.0710),
    "bad mergentheim": (49.4920, 9.7730),
    "tauberbischofsheim": (49.6230, 9.6630),
    "heidenheim": (48.6780, 10.1520),
    "aalen": (48.8372, 10.0936),
    "schwäbisch gmünd": (48.7990, 9.7980),
    # Region Karlsruhe
    "karlsruhe": (49.0069, 8.4037),
    "ettlingen": (48.9410, 8.4070),
    "bruchsal": (49.1242, 8.5980),
    "bretten": (49.0367, 8.7050),
    "rastatt": (48.8590, 8.2070),
    "baden-baden": (48.7606, 8.2396),
    "mannheim": (49.4875, 8.4660),
    "heidelberg": (49.3988, 8.6724),
    "weinheim": (49.5490, 8.6700),
    "sinsheim": (49.2520, 8.8780),
    "mosbach": (49.3530, 9.1490),
    "pforzheim": (48.8922, 8.6946),
    "calw": (48.7140, 8.7400),
    "nagold": (48.5510, 8.7240),
    "freudenstadt": (48.4630, 8.4110),
    # Region Freiburg
    "freiburg": (47.9959, 7.8494),
    "offenburg": (48.4709, 7.9407),
    "lahr": (48.3410, 7.8730),
    "kehl": (48.5720, 7.8150),
    "emmendingen": (48.1206, 7.8492),
    "lörrach": (47.6150, 7.6647),
    "weil am rhein": (47.5930, 7.6200),
    "waldshut": (47.6230, 8.2150),
    "bad säckingen": (47.5530, 7.9490),
    # Region Tübingen
    "reutlingen": (48.4914, 9.2043),
    "tübingen": (48.5216, 9.0576),
    "metzingen": (48.5370, 9.2840),
    "balingen": (48.2750, 8.8540),
    "albstadt": (48.2120, 9.0240),
    "ulm": (48.4011, 9.9876),
    "ehingen": (48.2830, 9.7250),
    "biberach": (48.0980, 9.7900),
    "ravensburg": (47.7811, 9.6116),
    "weingarten": (47.8090, 9.6390),
    "wangen": (47.6890, 9.8330),
    "sigmaringen": (48.0870, 9.2160),
}

#: Sub-city landmarks in the Konstanz demo sector — pin-point precision for
#: the places eyewitness reports actually name, with zero network calls.
#: Checked together with PLACES (longest match wins), so "Fährhafen Staad"
#: resolves to the ferry port itself, not the Staad district centroid, and
#: never escalates to Nominatim.
LANDMARKS: dict[str, tuple[float, float]] = {
    # Staad ferry port (Konstanz–Meersburg car ferry)
    "staad fähre": (47.6775, 9.2061),
    "fährhafen staad": (47.6775, 9.2061),
    "fähre staad": (47.6775, 9.2061),
    "autofähre konstanz": (47.6775, 9.2061),
    # Konstanz Minster
    "münster konstanz": (47.6628, 9.1755),
    "konstanzer münster": (47.6628, 9.1755),
    "münster unserer lieben frau": (47.6628, 9.1755),
    "cathedral": (47.6628, 9.1755),
    # Council building (Konzil)
    "konzil konstanz": (47.6596, 9.1785),
    "konzilgebäude": (47.6596, 9.1785),
    "konzil": (47.6596, 9.1785),
    # Herosé-Park (Seerhein shore)
    "herosé-park": (47.6682, 9.1718),
    "herosé park": (47.6682, 9.1718),
    "herosepark": (47.6682, 9.1718),
    "herose-park": (47.6682, 9.1718),
}

#: Combined lookup — landmarks and town centroids share one matcher.
_ALL_PLACES: dict[str, tuple[float, float]] = {**PLACES, **LANDMARKS}

# Longest names first so "fährhafen staad" wins over "staad" and
# "stein am rhein" over a hypothetical "rhein".
_PATTERN: re.Pattern[str] = re.compile(
    "|".join(
        rf"\b{re.escape(name)}\b"
        for name in sorted(_ALL_PLACES, key=len, reverse=True)
    ),
    re.IGNORECASE,
)


def find(text: str) -> tuple[float, float] | None:
    """Coordinates of the first known place named in `text`, else None."""
    match = _PATTERN.search(text)
    if match is None:
        return None
    return _ALL_PLACES[match.group(0).lower()]
