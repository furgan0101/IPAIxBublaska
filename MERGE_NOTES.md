# MERGE_NOTES - branch `feature/sources-confidence-perf`

Reconciliation log for a parallel session. This branch adds 4 keyless data
sources, a real confidence spread with confidence-coloured map pins, and a
frontend performance pass. It was built to avoid the collaborator's in-flight
bug work; the few owned-file edits below are surgical and sit in different
functions/lines than the four bugs being fixed in parallel.

## New files (zero conflict)
- backend/ingestion/pegelonline.py, usgs.py, eonet.py, gdacs.py
- backend/tests/fixtures/pegelonline.json, usgs_2.5_day.geojson, eonet_events.json, gdacs_rss.xml
- backend/tests/test_new_sources.py  (10 tests, offline, httpx.MockTransport)
- frontend/src/lib/confidence.ts
- frontend/src/app/loading.tsx, error.tsx, not-found.tsx, manifest.ts
- PERF_NOTES.md, MERGE_NOTES.md

## Owned-file edits (additive, surgical)
1. frontend/src/lib/liveAdapter.ts
   - import blendConfidence from "@/lib/confidence".
   - adaptIncident: added `officialCount`; the `confidence:` field now uses
     blendConfidence(...) instead of Math.round(confidence_score*100).
     The `city:` lines (collaborator's BUG 3) are NOT touched.
   - adaptDebunked: `confidence:` now uses blendConfidence(...).
   - SOURCE_TYPE + OFFICIAL_SOURCES gained dwd/pegelonline/usgs/eonet/gdacs.
2. frontend/src/components/crisislens/CrisisMap.tsx
   - import band helpers from "@/lib/confidence".
   - the `icons` memo is now keyed by confidence band (BAND_COLORS) instead of
     the single STATUS_META status colour.
   - each Marker: icon picked by confidenceBand(report.confidence) and a new
     `opacity={confidenceOpacity(report.confidence)}`.
   - MapController (BUG 2) and the place-name tooltip (BUG 3) are NOT touched.
   - FOLLOW-UP: Dashboard's map legend still shows the old triage colours.
     Update it to the confidence scale (BAND_COLORS) for consistency. Left
     alone here because Dashboard.tsx is collaborator-owned.
3. frontend/src/app/globals.css - APPEND ONLY (no existing rule changed):
   will-change on the selected ring, `.cl-gpu`, `.cl-virtualise`, and a full
   `@media (prefers-reduced-motion: reduce)` block (there was none).
4. frontend/next.config.ts - optimizePackageImports ["lucide-react"],
   poweredByHeader:false, compress:true. reactStrictMode was deliberately NOT
   enabled, to avoid double-firing the map effects during your dev debugging.
5. backend/ingestion/service.py - additive only: 4 connector imports;
   default_connectors() refactored from a list literal to a `connectors` var
   plus 4 config-gated appends; ID_PREFIXES and OFFICIAL_CONFIDENCE_FLOOR each
   gained 4 entries. `_to_debunked`, clustering and `_with_source_trust` are
   NOT touched.
6. backend/ingestion/config.py (not owned) - 4 opt-in bool fields (default
   False) + their from_env flags.
7. backend/.env.example (not owned) - 4 flag docs.

## Data sources
Added (keyless, pre-geocoded, default OFF, offline-tested):
- PEGELONLINE (WSV waterway gauges) -> flood signal from high-water state.
- USGS earthquakes (GeoJSON) -> earthquake.
- NASA EONET (open natural events) -> wildfire/storm/flood.
- GDACS global disaster alerts (RSS) -> flood/earthquake/storm/wildfire.
Each is global/national; the existing sector filter keeps only nearby events.
Enable per source in backend/.env (PEGELONLINE_ENABLED / USGS_ENABLED /
EONET_ENABLED / GDACS_ENABLED).

Deferred (documented, not added):
- Reddit (social): posts are not pre-geocoded, so they would hit the
  Nominatim 1/s bottleneck. Defer until a geocoding budget exists.
- MobiData BW, VerkehrsInfo BW, Copernicus EMS/EFAS: require an API key or
  registration, so out of scope for the keyless rule.

## Pre-existing test failures (NOT from this branch)
4 tests fail on the branch base commit (2794e77) already, unrelated to this
work, in files the collaborator owns (mock data + pipeline/classifier):
- tests/test_pipeline.py::test_mock_data_matches_raw_report_schema (expects 12,
  mock_data.json now has 60)
- tests/test_pipeline.py::test_full_pipeline_on_mock_data (expects 4 debunked /
  8 incident-reports; actual 35 / 25)
- tests/test_pipeline.py::test_single_source_incident_gets_low_corroboration_hint
- tests/test_ingestion.py::test_classifier_matches_every_credible_mock_report
Left untouched on purpose: the collaborator is reworking the mock dataset
tonight (mannheim_fire_mock.json), which will change these numbers again. All
NEW tests on this branch pass (test_new_sources.py: 10/10), and the rest of the
suite is green (70 passed, 4 pre-existing failures).
