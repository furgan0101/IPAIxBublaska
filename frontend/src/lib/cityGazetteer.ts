/**
 * Offline city gazetteer for the search bar — zero network calls.
 *
 * Mock-only mandate: search-to-zoom must never hit a geocoding API, so city
 * names are resolved against this local table instead. Covers every city in
 * the mock dataset, the larger towns of Baden-Württemberg, and the major
 * German cities. Centroids are approximate town centres — precise enough to
 * frame the city on the map.
 */

export interface CityHit {
  /** Canonical display name. */
  name: string;
  /** [lat, lon] — WGS84. */
  center: [number, number];
}

/**
 * Ordered by lookup priority: mock-dataset cities first, then BW by size,
 * then major German cities. Prefix matches return the first entry.
 */
const CITIES: ReadonlyArray<[name: string, lat: number, lon: number]> = [
  // Cities present in the mock dataset
  ["Konstanz", 47.6603, 9.1758],
  ["Stuttgart", 48.7758, 9.1829],
  ["Freiburg", 47.999, 7.8421],
  ["Karlsruhe", 49.0069, 8.4037],
  ["Mannheim", 49.4875, 8.466],
  ["Ulm", 48.4011, 9.9876],
  ["Heidelberg", 49.3988, 8.6724],
  ["Heilbronn", 49.1427, 9.2109],
  // Baden-Württemberg
  ["Pforzheim", 48.8922, 8.6946],
  ["Reutlingen", 48.4914, 9.2043],
  ["Tübingen", 48.5216, 9.0576],
  ["Esslingen", 48.7406, 9.3108],
  ["Ludwigsburg", 48.8973, 9.1916],
  ["Göppingen", 48.7025, 9.6527],
  ["Aalen", 48.8378, 10.0933],
  ["Schwäbisch Gmünd", 48.799, 9.798],
  ["Schwäbisch Hall", 49.1124, 9.737],
  ["Baden-Baden", 48.7606, 8.2396],
  ["Offenburg", 48.4729, 7.9407],
  ["Friedrichshafen", 47.6542, 9.4795],
  ["Ravensburg", 47.7811, 9.6114],
  ["Villingen-Schwenningen", 48.0606, 8.4594],
  ["Singen", 47.7623, 8.84],
  ["Radolfzell", 47.7372, 8.971],
  ["Lörrach", 47.6167, 7.6647],
  ["Waldshut-Tiengen", 47.623, 8.214],
  ["Rottweil", 48.168, 8.627],
  ["Tuttlingen", 47.9847, 8.8233],
  ["Sigmaringen", 48.0867, 9.2165],
  ["Biberach", 48.0985, 9.7873],
  ["Heidenheim", 48.6761, 10.1545],
  ["Crailsheim", 49.1383, 10.0706],
  ["Mosbach", 49.3539, 9.1428],
  ["Bad Mergentheim", 49.4925, 9.7733],
  ["Bruchsal", 49.1247, 8.598],
  ["Ettlingen", 48.9416, 8.4079],
  ["Rastatt", 48.859, 8.2095],
  ["Lahr", 48.3399, 7.8742],
  ["Emmendingen", 48.1216, 7.849],
  ["Balingen", 48.2753, 8.8503],
  ["Albstadt", 48.2119, 9.0239],
  ["Freudenstadt", 48.4633, 8.4111],
  ["Calw", 48.714, 8.738],
  ["Nagold", 48.55, 8.725],
  ["Leonberg", 48.8, 9.013],
  ["Böblingen", 48.685, 9.0139],
  ["Sindelfingen", 48.7133, 9.0028],
  ["Herrenberg", 48.595, 8.866],
  ["Nürtingen", 48.627, 9.342],
  ["Kirchheim unter Teck", 48.648, 9.451],
  ["Waiblingen", 48.8303, 9.3169],
  ["Schorndorf", 48.805, 9.527],
  ["Backnang", 48.947, 9.43],
  ["Bietigheim-Bissingen", 48.958, 9.137],
  ["Fellbach", 48.809, 9.279],
  ["Filderstadt", 48.677, 9.221],
  ["Ostfildern", 48.727, 9.262],
  ["Weinheim", 49.548, 8.67],
  ["Sinsheim", 49.252, 8.878],
  ["Wiesloch", 49.294, 8.698],
  ["Schwetzingen", 49.384, 8.573],
  ["Hockenheim", 49.323, 8.55],
  ["Bretten", 49.036, 8.707],
  ["Wertheim", 49.759, 9.517],
  ["Öhringen", 49.2, 9.502],
  ["Ehingen", 48.283, 9.726],
  ["Laupheim", 48.227, 9.879],
  ["Wangen im Allgäu", 47.686, 9.834],
  ["Leutkirch", 47.827, 10.022],
  ["Überlingen", 47.7681, 9.165],
  ["Meersburg", 47.6939, 9.27],
  ["Markdorf", 47.72, 9.391],
  ["Stockach", 47.851, 9.009],
  ["Donaueschingen", 47.953, 8.497],
  ["Kehl", 48.571, 7.815],
  ["Breisach", 48.028, 7.582],
  ["Rheinfelden", 47.561, 7.793],
  ["Weil am Rhein", 47.593, 7.62],
  // Major German cities outside BW
  ["Berlin", 52.52, 13.405],
  ["Hamburg", 53.5511, 9.9937],
  ["München", 48.1351, 11.582],
  ["Köln", 50.9375, 6.9603],
  ["Frankfurt", 50.1109, 8.6821],
  ["Düsseldorf", 51.2277, 6.7735],
  ["Dortmund", 51.5136, 7.4653],
  ["Essen", 51.4556, 7.0116],
  ["Leipzig", 51.3397, 12.3731],
  ["Bremen", 53.0793, 8.8017],
  ["Dresden", 51.0504, 13.7373],
  ["Hannover", 52.3759, 9.732],
  ["Nürnberg", 49.4521, 11.0767],
  ["Bochum", 51.4818, 7.2162],
  ["Wuppertal", 51.2562, 7.1508],
  ["Bielefeld", 52.0302, 8.5325],
  ["Bonn", 50.7374, 7.0982],
  ["Münster", 51.9607, 7.6261],
  ["Augsburg", 48.3705, 10.8978],
  ["Wiesbaden", 50.0782, 8.2398],
  ["Mainz", 49.9929, 8.2473],
  ["Kassel", 51.3127, 9.4797],
  ["Saarbrücken", 49.2402, 6.9969],
  ["Erfurt", 50.9848, 11.0299],
  ["Rostock", 54.0924, 12.0991],
  ["Kiel", 54.3233, 10.1228],
  ["Magdeburg", 52.1205, 11.6276],
  ["Potsdam", 52.3906, 13.0645],
  ["Würzburg", 49.7913, 9.9534],
  ["Regensburg", 49.0134, 12.1016],
  ["Ingolstadt", 48.7665, 11.4258],
];

/**
 * Fold a name for matching: lowercase, ß→ss, strip diacritics (ä→a …),
 * then collapse German transliterations (ae→a, oe→o, ue→u) so that
 * "Tübingen", "Tuebingen" and "tubingen" all hit the same key. Both the
 * query and the table keys go through the identical fold, so the collapse
 * stays consistent.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

function fold(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replaceAll("ae", "a")
    .replaceAll("oe", "o")
    .replaceAll("ue", "u");
}

const FOLDED: ReadonlyArray<{ key: string; hit: CityHit }> = CITIES.map(
  ([name, lat, lon]) => ({
    key: fold(name),
    hit: { name, center: [lat, lon] },
  }),
);

/**
 * Nearest known city to a coordinate — used to label backend pipeline
 * incidents (which carry only lat/lon) with a real city name so the
 * search-by-city filter works. Equirectangular distance is plenty for
 * picking the closest centroid; the longitude term is cosine-corrected
 * for the latitude. Fully offline.
 */
export function nearestCity(lat: number, lon: number): string {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let bestName = CITIES[0][0];
  let bestDist = Infinity;
  for (const [name, clat, clon] of CITIES) {
    const dLat = lat - clat;
    const dLon = (lon - clon) * cosLat;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) {
      bestDist = dist;
      bestName = name;
    }
  }
  return bestName;
}

/**
 * Autocomplete suggestions for the typeahead, fully offline. Prefix matches
 * rank above substring matches; within each, the gazetteer's own priority
 * order (mock cities → BW by size → Germany) is preserved. Empty query → [].
 */
export function suggestCities(query: string, limit = 6): CityHit[] {
  const folded = fold(query);
  if (folded.length < 1) return [];
  const prefix: CityHit[] = [];
  const contains: CityHit[] = [];
  for (const entry of FOLDED) {
    if (entry.key.startsWith(folded)) prefix.push(entry.hit);
    else if (entry.key.includes(folded)) contains.push(entry.hit);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/**
 * Resolve a free-text query to a city, fully offline.
 * Exact (folded) match wins; otherwise the first prefix match in table
 * order (mock cities → BW by size → Germany). Returns null when nothing
 * matches — the caller decides how to surface that.
 */
export function searchCity(query: string): CityHit | null {
  const folded = fold(query);
  if (folded.length < 2) return null;

  const exact = FOLDED.find((entry) => entry.key === folded);
  if (exact) return exact.hit;

  if (folded.length >= 3) {
    const prefix = FOLDED.find((entry) => entry.key.startsWith(folded));
    if (prefix) return prefix.hit;
  }
  return null;
}
