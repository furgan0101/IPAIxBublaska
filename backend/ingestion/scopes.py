"""Search-scope registry: user-selectable geographic regions for the pipeline.

A Scope bundles everything region-dependent: the geographic containment test
(bbox or point+radius), the Nominatim bias (countrycodes + viewbox), the
language prefilter, and the social keyword/hashtag sets for the Bluesky
firehose prefilter and Mastodon tag timelines.

Presets shipped: the Konstanz demo sector (default), Germany, USA, the
European Union, all 16 German states and all 50 US states. Bounding boxes are
deliberately approximate (generous rectangles; Alaska clamped east of the
antimeridian) — final precision comes from geocoding + the containment test.

Caveats (documented, by design): the crisis classifier is German/English, so
non-DE/EN posts in EU scopes are under-detected; NINA + Presseportal are
German sources and simply go quiet outside Germany — Bluesky/Mastodon carry
non-German scopes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from geopy.distance import geodesic

GROUP_REGIONS: str = "Region"
GROUP_DE: str = "Germany — States"
GROUP_US: str = "USA — States"

#: 27 EU member states (Nominatim countrycodes).
EU_COUNTRYCODES: str = (
    "at,be,bg,hr,cy,cz,dk,ee,fi,fr,de,gr,hu,ie,it,lv,lt,lu,mt,nl,pl,pt,ro,sk,si,es,se"
)


def _zoom_for_lat_span(span: float) -> int:
    """Rough Leaflet zoom so the bbox fills a dashboard-sized map."""
    if span > 20:
        return 4
    if span > 10:
        return 5
    if span > 5:
        return 6
    if span > 2.5:
        return 7
    if span > 1.2:
        return 8
    return 9


@dataclass(frozen=True)
class Scope:
    """One selectable search region (containment + geocoding + social filters)."""

    id: str
    label: str
    group: str
    mode: str  # "radius" | "bbox"
    bbox: tuple[float, float, float, float]  # min_lat, min_lon, max_lat, max_lon
    countrycodes: str
    languages: tuple[str, ...]
    keywords: tuple[str, ...]
    radius_km: float = 0.0  # radius mode only
    tags: tuple[str, ...] | None = None  # explicit Mastodon tags (else derived)
    center_override: tuple[float, float] | None = None

    @property
    def center(self) -> tuple[float, float]:
        if self.center_override is not None:
            return self.center_override
        min_lat, min_lon, max_lat, max_lon = self.bbox
        return (round((min_lat + max_lat) / 2, 4), round((min_lon + max_lon) / 2, 4))

    @property
    def zoom(self) -> int:
        if self.mode == "radius":
            return 11 if self.radius_km <= 50 else 9
        return _zoom_for_lat_span(self.bbox[2] - self.bbox[0])

    def contains(self, lat: float, lon: float) -> bool:
        if self.mode == "radius":
            distance_km = geodesic((lat, lon), self.center).kilometers
            return distance_km <= self.radius_km
        min_lat, min_lon, max_lat, max_lon = self.bbox
        return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon

    def viewbox(self) -> str:
        """Nominatim viewbox string: lon_left,lat_top,lon_right,lat_bottom."""
        min_lat, min_lon, max_lat, max_lon = self.bbox
        return f"{min_lon},{max_lat},{max_lon},{min_lat}"

    def hashtags(self) -> tuple[str, ...]:
        """Mastodon hashtags: explicit tags, else derived from keywords."""
        if self.tags is not None:
            return self.tags
        derived = tuple(
            keyword.replace(" ", "").replace("-", "")
            for keyword in self.keywords
            if len(keyword) >= 4
        )
        return derived[:8]

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "group": self.group,
            "mode": self.mode,
            "bbox": list(self.bbox),
            "center": list(self.center),
            "zoom": self.zoom,
        }


def _scope(
    scope_id: str,
    label: str,
    group: str,
    bbox: tuple[float, float, float, float],
    countrycodes: str,
    languages: tuple[str, ...],
    keywords: tuple[str, ...],
) -> Scope:
    return Scope(
        id=scope_id,
        label=label,
        group=group,
        mode="bbox",
        bbox=bbox,
        countrycodes=countrycodes,
        languages=languages,
        keywords=tuple(keyword.lower() for keyword in keywords),
    )


DE_LANGS: tuple[str, ...] = ("de", "en")
US_LANGS: tuple[str, ...] = ("en",)
EU_LANGS: tuple[str, ...] = ("en", "de", "fr", "es", "it", "nl", "pl")

KONSTANZ_SECTOR = Scope(
    id="konstanz-sector",
    label="Konstanz Sector",
    group=GROUP_REGIONS,
    mode="radius",
    bbox=(47.25, 8.40, 48.35, 9.95),
    countrycodes="de,ch,at",
    languages=DE_LANGS,
    keywords=(
        "konstanz",
        "bodensee",
        "kreuzlingen",
        "radolfzell",
        "singen",
        "reichenau",
        "allensbach",
    ),
    radius_km=40.0,
    tags=("konstanz", "bodensee", "hochwasser", "unwetter", "blaulicht", "katwarn", "sturm"),
    center_override=(47.6603, 9.1758),
)

# --- top-level regions -----------------------------------------------------------------

_REGIONS: tuple[Scope, ...] = (
    KONSTANZ_SECTOR,
    _scope(
        "germany", "Germany", GROUP_REGIONS,
        (47.27, 5.87, 55.06, 15.04), "de", DE_LANGS,
        ("germany", "deutschland", "berlin", "hamburg", "münchen", "munich", "köln",
         "cologne", "frankfurt", "stuttgart", "düsseldorf", "leipzig", "dortmund",
         "essen", "bremen", "dresden", "hannover", "nürnberg"),
    ),
    _scope(
        "usa", "USA", GROUP_REGIONS,
        (24.5, -125.0, 49.5, -66.9), "us", US_LANGS,
        ("usa", "united states", "america", "new york", "nyc", "los angeles",
         "chicago", "houston", "phoenix", "philadelphia", "san antonio", "san diego",
         "dallas", "seattle", "miami", "atlanta", "boston", "denver", "washington"),
    ),
    _scope(
        "european-union", "European Union", GROUP_REGIONS,
        (34.5, -10.5, 71.5, 31.6), EU_COUNTRYCODES, EU_LANGS,
        ("europe", "european union", "paris", "berlin", "madrid", "rome", "roma",
         "amsterdam", "brussels", "vienna", "wien", "warsaw", "warszawa", "lisbon",
         "dublin", "stockholm", "copenhagen", "helsinki", "prague", "praha", "athens"),
    ),
)

# --- German states (id, label, bbox, keywords) --------------------------------------------

_DE_STATES: tuple[tuple[str, str, tuple[float, float, float, float], tuple[str, ...]], ...] = (
    ("baden-wuerttemberg", "Baden-Württemberg", (47.53, 7.51, 49.79, 10.50),
     ("baden-württemberg", "baden-wuerttemberg", "stuttgart", "karlsruhe", "mannheim",
      "freiburg", "heidelberg", "ulm", "heilbronn", "pforzheim", "konstanz", "reutlingen")),
    ("bayern", "Bayern", (47.27, 9.35, 50.56, 13.84),
     ("bayern", "bavaria", "münchen", "munich", "nürnberg", "nuremberg", "augsburg",
      "regensburg", "würzburg", "ingolstadt", "fürth", "erlangen")),
    ("berlin", "Berlin", (52.34, 13.09, 52.68, 13.76),
     ("berlin", "spandau", "kreuzberg", "neukölln", "charlottenburg", "pankow")),
    ("brandenburg", "Brandenburg", (51.36, 11.27, 53.56, 14.77),
     ("brandenburg", "potsdam", "cottbus", "frankfurt oder", "oranienburg", "eberswalde")),
    ("bremen", "Bremen", (53.01, 8.48, 53.61, 8.99),
     ("bremen", "bremerhaven")),
    ("hamburg", "Hamburg", (53.39, 9.73, 53.74, 10.33),
     ("hamburg", "altona", "harburg", "bergedorf", "wandsbek")),
    ("hessen", "Hessen", (49.40, 7.77, 51.66, 10.24),
     ("hessen", "hesse", "frankfurt", "wiesbaden", "kassel", "darmstadt", "offenbach",
      "gießen", "fulda")),
    ("mecklenburg-vorpommern", "Mecklenburg-Vorpommern", (53.11, 10.59, 54.69, 14.41),
     ("mecklenburg-vorpommern", "mecklenburg", "rostock", "schwerin", "stralsund",
      "greifswald", "neubrandenburg")),
    ("niedersachsen", "Niedersachsen", (51.29, 6.65, 53.89, 11.60),
     ("niedersachsen", "lower saxony", "hannover", "braunschweig", "osnabrück",
      "oldenburg", "göttingen", "wolfsburg", "hildesheim")),
    ("nordrhein-westfalen", "Nordrhein-Westfalen", (50.32, 5.87, 52.53, 9.46),
     ("nordrhein-westfalen", "nrw", "köln", "cologne", "düsseldorf", "dortmund",
      "essen", "duisburg", "bochum", "wuppertal", "bielefeld", "bonn", "münster", "aachen")),
    ("rheinland-pfalz", "Rheinland-Pfalz", (48.97, 6.11, 50.94, 8.51),
     ("rheinland-pfalz", "mainz", "ludwigshafen", "koblenz", "trier", "kaiserslautern", "worms")),
    ("saarland", "Saarland", (49.11, 6.36, 49.64, 7.40),
     ("saarland", "saarbrücken", "saarbruecken", "neunkirchen", "völklingen", "homburg")),
    ("sachsen", "Sachsen", (50.17, 11.87, 51.68, 15.04),
     ("sachsen", "saxony", "dresden", "leipzig", "chemnitz", "zwickau", "görlitz", "plauen")),
    ("sachsen-anhalt", "Sachsen-Anhalt", (50.94, 10.56, 53.04, 13.19),
     ("sachsen-anhalt", "magdeburg", "halle", "dessau", "stendal", "wittenberg")),
    ("schleswig-holstein", "Schleswig-Holstein", (53.36, 7.87, 55.06, 11.31),
     ("schleswig-holstein", "kiel", "lübeck", "luebeck", "flensburg", "neumünster", "itzehoe")),
    ("thueringen", "Thüringen", (50.20, 9.88, 51.65, 12.65),
     ("thüringen", "thueringen", "thuringia", "erfurt", "jena", "gera", "weimar", "gotha")),
)

# --- US states (id, label, bbox, keywords) ---------------------------------------------------

_US_STATES: tuple[tuple[str, str, tuple[float, float, float, float], tuple[str, ...]], ...] = (
    ("us-alabama", "Alabama", (30.1, -88.5, 35.0, -84.9),
     ("alabama", "birmingham", "montgomery", "mobile", "huntsville")),
    ("us-alaska", "Alaska", (51.2, -170.0, 71.4, -129.9),
     ("alaska", "anchorage", "fairbanks", "juneau")),
    ("us-arizona", "Arizona", (31.3, -114.8, 37.0, -109.0),
     ("arizona", "phoenix", "tucson", "mesa", "scottsdale")),
    ("us-arkansas", "Arkansas", (33.0, -94.6, 36.5, -89.6),
     ("arkansas", "little rock", "fayetteville", "fort smith")),
    ("us-california", "California", (32.5, -124.4, 42.0, -114.1),
     ("california", "los angeles", "san francisco", "san diego", "sacramento",
      "san jose", "oakland", "fresno")),
    ("us-colorado", "Colorado", (36.99, -109.06, 41.0, -102.04),
     ("colorado", "denver", "colorado springs", "boulder", "aurora")),
    ("us-connecticut", "Connecticut", (40.95, -73.73, 42.05, -71.78),
     ("connecticut", "hartford", "new haven", "bridgeport", "stamford")),
    ("us-delaware", "Delaware", (38.45, -75.79, 39.84, -75.05),
     ("delaware", "wilmington", "dover", "newark delaware")),
    ("us-florida", "Florida", (24.5, -87.6, 31.0, -80.0),
     ("florida", "miami", "orlando", "tampa", "jacksonville", "tallahassee",
      "fort lauderdale")),
    ("us-georgia", "Georgia", (30.36, -85.6, 35.0, -80.84),
     ("georgia", "atlanta", "savannah", "augusta", "columbus georgia")),
    ("us-hawaii", "Hawaii", (18.9, -160.3, 22.25, -154.8),
     ("hawaii", "honolulu", "maui", "oahu", "hilo")),
    ("us-idaho", "Idaho", (42.0, -117.24, 49.0, -111.04),
     ("idaho", "boise", "idaho falls", "coeur d'alene")),
    ("us-illinois", "Illinois", (36.97, -91.5, 42.5, -87.0),
     ("illinois", "chicago", "springfield illinois", "peoria", "rockford")),
    ("us-indiana", "Indiana", (37.77, -88.1, 41.76, -84.78),
     ("indiana", "indianapolis", "fort wayne", "evansville", "south bend")),
    ("us-iowa", "Iowa", (40.37, -96.64, 43.5, -90.14),
     ("iowa", "des moines", "cedar rapids", "davenport")),
    ("us-kansas", "Kansas", (36.99, -102.05, 40.0, -94.59),
     ("kansas", "wichita", "topeka", "overland park")),
    ("us-kentucky", "Kentucky", (36.5, -89.6, 39.15, -81.96),
     ("kentucky", "louisville", "lexington", "bowling green")),
    ("us-louisiana", "Louisiana", (28.9, -94.05, 33.02, -88.8),
     ("louisiana", "new orleans", "baton rouge", "shreveport", "lafayette")),
    ("us-maine", "Maine", (43.06, -71.08, 47.46, -66.95),
     ("maine", "portland maine", "bangor", "augusta maine")),
    ("us-maryland", "Maryland", (37.9, -79.49, 39.72, -75.05),
     ("maryland", "baltimore", "annapolis", "rockville")),
    ("us-massachusetts", "Massachusetts", (41.24, -73.51, 42.89, -69.93),
     ("massachusetts", "boston", "worcester", "springfield massachusetts", "cambridge")),
    ("us-michigan", "Michigan", (41.7, -90.42, 48.3, -82.12),
     ("michigan", "detroit", "grand rapids", "lansing", "ann arbor", "flint")),
    ("us-minnesota", "Minnesota", (43.5, -97.24, 49.38, -89.49),
     ("minnesota", "minneapolis", "saint paul", "duluth", "rochester minnesota")),
    ("us-mississippi", "Mississippi", (30.17, -91.65, 35.0, -88.1),
     ("mississippi", "jackson mississippi", "gulfport", "biloxi")),
    ("us-missouri", "Missouri", (35.99, -95.77, 40.61, -89.1),
     ("missouri", "kansas city", "st louis", "saint louis", "springfield missouri")),
    ("us-montana", "Montana", (44.36, -116.05, 49.0, -104.04),
     ("montana", "billings", "missoula", "bozeman", "helena")),
    ("us-nebraska", "Nebraska", (40.0, -104.05, 43.0, -95.31),
     ("nebraska", "omaha", "lincoln nebraska", "grand island")),
    ("us-nevada", "Nevada", (35.0, -120.0, 42.0, -114.04),
     ("nevada", "las vegas", "reno", "henderson nevada")),
    ("us-new-hampshire", "New Hampshire", (42.7, -72.56, 45.3, -70.6),
     ("new hampshire", "manchester nh", "concord nh", "nashua")),
    ("us-new-jersey", "New Jersey", (38.93, -75.56, 41.36, -73.89),
     ("new jersey", "newark", "jersey city", "trenton", "atlantic city")),
    ("us-new-mexico", "New Mexico", (31.33, -109.05, 37.0, -103.0),
     ("new mexico", "albuquerque", "santa fe", "las cruces")),
    ("us-new-york", "New York", (40.5, -79.76, 45.02, -71.85),
     ("new york", "nyc", "manhattan", "brooklyn", "buffalo", "rochester", "albany",
      "syracuse")),
    ("us-north-carolina", "North Carolina", (33.84, -84.32, 36.59, -75.46),
     ("north carolina", "charlotte", "raleigh", "greensboro", "durham", "asheville")),
    ("us-north-dakota", "North Dakota", (45.94, -104.05, 49.0, -96.55),
     ("north dakota", "fargo", "bismarck", "grand forks")),
    ("us-ohio", "Ohio", (38.4, -84.82, 41.98, -80.52),
     ("ohio", "columbus", "cleveland", "cincinnati", "toledo", "akron", "dayton")),
    ("us-oklahoma", "Oklahoma", (33.62, -103.0, 37.0, -94.43),
     ("oklahoma", "oklahoma city", "tulsa", "norman")),
    ("us-oregon", "Oregon", (41.99, -124.57, 46.29, -116.46),
     ("oregon", "portland", "salem oregon", "eugene", "bend")),
    ("us-pennsylvania", "Pennsylvania", (39.72, -80.52, 42.27, -74.69),
     ("pennsylvania", "philadelphia", "pittsburgh", "harrisburg", "allentown", "erie")),
    ("us-rhode-island", "Rhode Island", (41.14, -71.86, 42.02, -71.12),
     ("rhode island", "providence", "warwick", "cranston")),
    ("us-south-carolina", "South Carolina", (32.03, -83.35, 35.22, -78.54),
     ("south carolina", "charleston", "columbia", "myrtle beach", "greenville")),
    ("us-south-dakota", "South Dakota", (42.48, -104.06, 45.95, -96.44),
     ("south dakota", "sioux falls", "rapid city", "pierre")),
    ("us-tennessee", "Tennessee", (34.98, -90.31, 36.68, -81.65),
     ("tennessee", "nashville", "memphis", "knoxville", "chattanooga")),
    ("us-texas", "Texas", (25.84, -106.65, 36.5, -93.51),
     ("texas", "houston", "dallas", "austin", "san antonio", "fort worth", "el paso",
      "corpus christi")),
    ("us-utah", "Utah", (37.0, -114.05, 42.0, -109.04),
     ("utah", "salt lake city", "provo", "ogden", "st george")),
    ("us-vermont", "Vermont", (42.73, -73.44, 45.02, -71.46),
     ("vermont", "burlington", "montpelier", "rutland")),
    ("us-virginia", "Virginia", (36.54, -83.68, 39.47, -75.24),
     ("virginia", "virginia beach", "richmond", "norfolk", "arlington", "roanoke")),
    ("us-washington", "Washington", (45.54, -124.85, 49.0, -116.92),
     ("washington state", "seattle", "spokane", "tacoma", "bellevue", "olympia")),
    ("us-west-virginia", "West Virginia", (37.2, -82.65, 40.64, -77.72),
     ("west virginia", "charleston wv", "morgantown", "huntington", "wheeling")),
    ("us-wisconsin", "Wisconsin", (42.49, -92.89, 47.08, -86.81),
     ("wisconsin", "milwaukee", "madison", "green bay", "kenosha")),
    ("us-wyoming", "Wyoming", (40.99, -111.06, 45.0, -104.05),
     ("wyoming", "cheyenne", "casper", "jackson hole", "laramie")),
)


def _build_registry() -> dict[str, Scope]:
    registry: dict[str, Scope] = {scope.id: scope for scope in _REGIONS}
    for state_id, label, bbox, keywords in _DE_STATES:
        registry[state_id] = _scope(state_id, label, GROUP_DE, bbox, "de", DE_LANGS, keywords)
    for state_id, label, bbox, keywords in _US_STATES:
        registry[state_id] = _scope(state_id, label, GROUP_US, bbox, "us", US_LANGS, keywords)
    return registry


#: id -> Scope, in display order (regions, then DE states, then US states).
SCOPES: dict[str, Scope] = _build_registry()

DEFAULT_SCOPE_ID: str = "konstanz-sector"


def scopes_for_api(active_id: str) -> dict[str, Any]:
    """Payload for GET /api/scopes — the single source of truth for the UI."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for scope in SCOPES.values():
        groups.setdefault(scope.group, []).append(scope.as_dict())
    return {
        "active": active_id,
        "scopes": [scope.as_dict() for scope in SCOPES.values()],
        "groups": [
            {"group": group, "items": items}
            for group, items in groups.items()
        ],
    }
