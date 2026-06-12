# CLAUDE.md

Global system prompt and operating guide for the **Automated OSINT Situational Awareness Dashboard** — a hackathon project for **VOSTbw** (Virtual Operations Support Team Baden-Württemberg). The system ingests open-source crisis reports, runs an AI credibility filter plus temporal/spatial verification to separate real incidents from disinformation, and plots the result on a live map. Demo sector: **Konstanz** (47.6603 N, 9.1758 E).

---

## Project Architecture

### Backend — Python / FastAPI (`backend/`)
- **AI orchestration** — `logic/verification.py`: two-layer credibility filter. Deterministic heuristics always run first (bot-spam markers, stale EXIF, geotag drift); an opt-in **live LLM analyst** (OpenAI SDK → LiteLLM gateway, model `stackit-qwen-qwen3-vl-235b-a22b-instruct-fp8`, optional vision) judges tone/plausibility on top. Env via `backend/.env`: `LITELLM_API_KEY`, `USE_LIVE_AI`, `USE_VISION`. LLM output is strict JSON validated by Pydantic (`LLMAnalysis`); bad JSON → `AI Parsing Error` debunk; infra failure → heuristic fallback (never crash).
- **EXIF-based checks** — stale capture timestamps (recycled footage) and conflicting geotags, parsed from report metadata.
- **Geospatial** — `logic/geospatial.py`: **Geopy** geodesic clustering (same event type + **1.0 km radius** + **60 min window** → one `VerifiedIncident`). PostGIS is the scale-up path once a real DB lands; the MVP is in-memory.
- **Responder guidance** — `logic/guidance.py`: deterministic `severity` grading + per-incident `action_hint` (the challenge's "action hints"); embedded into each `VerifiedIncident` together with its `sources` timeline. The event taxonomy (`KNOWN_EVENT_TYPES`, 27 classes) mirrors the **BW Ministry of the Interior crisis catalogue** (natural hazards, tech/industrial, CBRN, pandemic, terrorism/security, supply crises, evacuations); the LLM classifier and `frontend/src/lib/eventMeta.tsx` are constrained/synced to it.
- **Schemas** — `schemas.py`: Pydantic models `RawReport`, `SourceReport`, `VerifiedIncident`, `DebunkedReport` (frontend mirror: `frontend/src/lib/types.ts` — keep in sync).
- **Live ingestion** — `backend/ingestion/`: keyless real-data connectors (NINA civil-protection warnings, Presseportal police RSS, Mastodon hashtags) with event classifier, Konstanz gazetteer + rate-limited Nominatim fallback geocoding, and a SQLite store (`backend/data/`, gitignored). Opt-in via `FEEDS_ENABLED=true` in `backend/.env` — the synthetic mock feed stays the offline default. Every live item flows through the same credibility filter + clustering. See `docs/LIVE_DATA.md`.
- **API** — `main.py`: `GET /api/incidents`, `GET /api/debunked`, `GET /api/health` (reports `ai_mode` and `data_mode`), plus `POST /api/reports` (live injection), `POST /api/reset` (demo reset), and `POST /api/poll` (trigger a live ingestion cycle); CORS open for `localhost:3000`.

### Frontend — Next.js (`frontend/`)
- **React 19 + Tailwind v4** App Router, TypeScript, `src/` layout. Design tokens (signal palette, glass panels, motion keyframes) live in `src/app/globals.css` (`@theme` / `@utility`); reduced-motion is honored globally.
- **Leaflet / React-Leaflet** — `src/components/Map.tsx`, client-side-only (dynamic import, `ssr: false`): red pins + 1 km rings on a CARTO dark basemap, hover/select cross-highlighting, fly-to controller, pulse rings on new incidents, amber DEBUNKED flash pin for hoaxes.
- **Sidebar** — `src/components/Sidebar.tsx`: tabs **Live Incidents** / **Disinfo Caught** (flag-rule badges + `reason_flagged`), swaps to `IncidentDetail.tsx` (dossier: confidence gauge, severity, action hint, source timeline) on selection.
- **SITREP layer** — `KpiStrip.tsx` (count-up KPIs + type breakdown), `FilterChips.tsx` (filters map + lists), `Toasts.tsx` (verdict notifications), `DemoControls.tsx` (collapsible scenario injector via `src/lib/presets.ts`).
- **Data layer** — `src/hooks/useDashboard.ts`: single poll loop (5 s) + on-demand refresh returning a snapshot; `useCountUp.ts` for animated numbers; shared event metadata in `src/lib/eventMeta.tsx`. UI state (selection, filter, tab, focus) is composed in `src/app/page.tsx`.

### Pipeline separation (keep these independently testable)
1. **Ingestion** — `mock_data.json` → validated `RawReport` list (`main.load_raw_reports`).
2. **AI verification** — credibility filter → geo-clustering (`logic/`).
3. **API routing** — thin FastAPI endpoints over the pipeline result.

```
.
├── backend/
│   ├── main.py            # FastAPI app + pipeline assembly
│   ├── schemas.py         # Pydantic models
│   ├── mock_data.json     # synthetic Konstanz feed (8 reports)
│   ├── logic/             # verification.py · geospatial.py
│   └── tests/             # pytest suite (schemas, rules, clustering)
├── frontend/
│   └── src/               # app/ · components/ · lib/
├── package.json           # root: concurrent dev-server runner
├── implementation-plan.md
└── README.md
```

---

## Run Commands

From the **repo root** (after `npm install` once):

```bash
npm run setup      # backend pip deps + frontend npm deps
npm run dev        # BOTH servers concurrently: api → :8000, web → :3000
npm run test:api   # backend pytest suite
```

Individual servers:

```bash
cd backend && python -m uvicorn main:app --reload --port 8000
cd frontend && npm run dev
```

---

## Hackathon Guardrails

1. **Always type-hint Python code.** Full annotations on every function signature; Pydantic models for all data crossing a boundary.
2. **Prioritize the "Happy Path" for the MVP.** A flawless end-to-end demo beats exhaustive edge-case coverage. Cut scope, not the demo.
3. **Mock-by-default for LLM and Vision APIs** to prevent rate-limiting and burned credits — never hit live AI/geocoding APIs during UI testing or pytest. Live mode is a pure config flip: `LITELLM_API_KEY` + `USE_LIVE_AI=true` in `backend/.env` (`/api/health` reports `mock` / `live-ready` / `live`). Tests must stay green offline with zero network calls.
4. **Always use the metric system.** Kilometres, metres, °C — in code, UI copy, and docs.
5. **Strict JSON output schemas** for all AI-filter logic: constrain the model, validate with Pydantic, fail loudly — no parsing crashes.
6. **Clean pipeline separation** between data ingestion, AI verification (temporal/spatial checks), and API routing.

---

## Skills

- **`verify-ai-pipeline`** — run backend tests for the extraction schema + 1 km radius math, no live APIs.
- **`generate-vost-mocks`** — regenerate the synthetic Konstanz feed in `backend/mock_data.json`.
- **`sync-dashboard`** — verify the frontend fetches/plots backend data; check marker formatting + lint.
