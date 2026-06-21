# VOSTbw — Automated OSINT Situational Awareness Dashboard

> **Hackathon project** — built at the **IPAI × Public Makers × Komm.one** hackathon, **June 2026**.
> For **VOST Baden-Württemberg** (Virtual Operations Support Team).

Ingests **live open-source crisis reports**, runs them through an **AI credibility filter** and a **geospatial verification engine**, and plots **verified incidents** on a live map — while exposing the **disinformation it caught** and the real-time environmental status (weather, water levels, traffic) for any location you search.

Demo sector centre: **Konstanz** (47.6603 N, 9.1758 E). All data is real OSINT — when the feeds are quiet, the map is legitimately empty.

---

## Run it

Requirements: **Python 3.10+**, **Node.js 18.18+**.

```bash
# 1. from the repo root
npm install            # installs the root dev-server runner
npm run setup          # installs backend (pip) + frontend (npm) dependencies

# 2. configure the backend
cp backend/.env.example backend/.env
#    then set LITELLM_API_KEY=<your key> in backend/.env
#    (or set USE_LIVE_AI=false to run the heuristic-only filter — no API key, no credits)

# 3. start both servers (API + web)
npm run dev
```

Then open **http://localhost:3000**.

Run the backend test suite (fully offline — no network, no AI credits):

```bash
npm run test:api
```

### Key configuration (`backend/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `FEEDS_ENABLED` | `true` | Live OSINT ingestion |
| `USE_LIVE_AI` | `true` | Live LLM analyst — set `false` for the deterministic heuristic filter (real logic, **no credits**) |
| `INGEST_NATIONAL` | `true` | Ingest nationwide so **any searched city** surfaces its news; `false` restricts to the Konstanz sector |
| `LITELLM_API_KEY` | — | Gateway key for the live analyst |
| `NOMINATIM_ENABLED` | `true` | Geocoding fallback (keyless, cached, rate-limited per OSM policy) |

`GET /api/health` reports the active `ai_mode` and `data_mode`.

---

## What it does (scope)

- **Live OSINT ingestion** — polls real, keyless open sources on an interval: **NINA** civil-protection warnings, **Presseportal** police/fire press releases, public **Mastodon** hashtag timelines, and **DWD** weather warnings. No synthetic feed.
- **AI credibility filter** — every report passes deterministic heuristics first (bot-spam phrasing, recycled-footage EXIF, geotag conflict), then an optional **live LLM analyst** (Qwen3-VL via the LiteLLM gateway) that judges tone, specificity and plausibility — and, with vision enabled, whether attached imagery matches the claim — returning a verdict **with a rationale**.
- **Geospatial verification** — surviving reports are clustered (same event type, **1 km** radius, **60 min** window) into verified incidents; confidence scales with the number of independent corroborating sources.
- **Responder guidance** — each incident carries an impact-based **severity**, a recommended **action**, and an agency-tagged **SOP checklist** (Polizei / Feuerwehr / THW / Rettungsdienst / LRA), mirroring the **BW Ministry of the Interior crisis catalogue** (27 event classes: natural hazards, technological/industrial, CBRN, pandemic, terrorism/security, supply crises, evacuations).
- **Search any German city** — ingestion runs nationwide; searching a city scopes the map, feed and stats to incidents within ~100 km of it.
- **Live status tiles** — header tiles give real-time context for the focused location from official open APIs: **DWD** weather warnings (via Bright Sky), **PegelOnline** water levels, and **MobiData BW** traffic/roadworks.
- **Disinfo caught** — a dedicated panel shows each rejected report with the rule that fired (`TEMPORAL` stale EXIF · `SPATIAL` geotag conflict · `LINGUISTIC` bot-spam · `OUTPUT GUARD` AI) and the exact reason.
- **Ingestion inbox** — `GET /api/ingestion/inbox` exposes every received item and how the pipeline disposed of it (verified / debunked / duplicate / stale / off-topic / unlocated) — full transparency into what came in but isn't on the map, and why.

---

## Architecture

```
live OSINT feeds ──▶ ingestion ──▶ AI credibility filter ──▶ geo-clustering ──▶ FastAPI ──▶ Next.js map
 NINA · Presse-       RawReport      heuristics + live LLM      1.0 km radius     (:8000)      (:3000)
 portal · Mastodon                   bot-spam / EXIF / vision   60 min window
 · DWD
```

- **Backend** — Python / FastAPI (`backend/`): ingestion connectors (`ingestion/`) → credibility filter (`logic/verification.py`) → geo-clustering (`logic/geospatial.py`) → responder guidance (`logic/guidance.py`), served over thin endpoints (`main.py`). SQLite store; in-memory served snapshot. Strictly type-hinted; Pydantic models for everything crossing a boundary.
- **Frontend** — Next.js / React 19 / Tailwind v4 (`frontend/`): Leaflet map with verification rings, live signal feed, incident dossier, and the live status tiles. A single 5 s poll loop (`hooks/useDashboard.ts`) is the only data source.

Clean pipeline separation: **ingestion · AI verification · API routing** are independently testable.

### Main endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/incidents` | Verified, clustered incidents |
| `GET` | `/api/debunked` | Reports caught by the credibility filter |
| `GET` | `/api/health` | Liveness, AI mode, per-connector feed status |
| `GET` | `/api/ingestion/inbox` | What was received + why it was/wasn't displayed |
| `GET` | `/api/{dwd,pegel,mobidata}/status` | Live status tiles |
| `POST` | `/api/poll` · `/api/reset` · `/api/reports` | Operator actions (poll now · wipe & re-poll · inject a report) |

---

## Notes

- **All data is real OSINT.** Sources: NINA (`warnung.bund.de`), Presseportal RSS, public Mastodon timelines, DWD (via Bright Sky), PegelOnline (WSV), MobiData BW. Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) / [CARTO](https://carto.com/attributions); geocoding via Nominatim (per OSM usage policy).
- **Metric system throughout** — kilometres, metres, °C.
- **Tests run fully offline** (`npm run test:api`): connectors replay recorded fixtures and the LLM client is monkeypatched — zero network calls, no burned credits.
