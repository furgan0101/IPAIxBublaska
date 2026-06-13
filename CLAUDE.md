# CLAUDE.md

Global system prompt and operating guide for the **Automated OSINT Situational Awareness Dashboard** — a hackathon project for **VOSTbw** (Virtual Operations Support Team Baden-Württemberg). The system ingests open-source crisis reports, runs an AI credibility filter plus temporal/spatial verification to separate real incidents from disinformation, and plots the result on a live map. Demo sector: **Konstanz** (47.6603 N, 9.1758 E).

---

## Project Architecture

### Backend — Python / FastAPI (`backend/`)
- **AI orchestration** — `logic/verification.py`: two-layer credibility filter. Deterministic heuristics always run first (bot-spam markers, stale EXIF, geotag drift); an opt-in **live LLM analyst** (OpenAI SDK → LiteLLM gateway, model `stackit-qwen-qwen3-vl-235b-a22b-instruct-fp8`) judges tone/plausibility on top and returns strict JSON (`LLMAnalysis`: verdict, event_type, score, `rationale`, `media_consistency`) validated by Pydantic. **Vision (USE_VISION=true)**: the gateway blocks remote image URLs (stackit.de allow-list), so media is downloaded and sent as a **base64 data URI** (≤5 MB, magic-byte sniffed; videos judged via their preview frame). Resilience: `LITELLM_API_KEYS` rotated on 429, ≤4 concurrent gateway calls, media/infra failures degrade to text-only/heuristics — never crash. Env via `backend/.env`: `LITELLM_API_KEY(S)`, `USE_LIVE_AI`, `USE_VISION`.
- **EXIF-based checks** — stale capture timestamps (recycled footage) and conflicting geotags, parsed from report metadata.
- **Geospatial** — `logic/geospatial.py`: **Geopy** geodesic clustering (same event type + **1.0 km radius** + **60 min window** → one `VerifiedIncident`). PostGIS is the scale-up path once a real DB lands; the MVP is in-memory.
- **Responder guidance** — `logic/guidance.py`: deterministic `severity` grading + per-incident `action_hint` (the challenge's "action hints"); embedded into each `VerifiedIncident` together with its `sources` timeline. The event taxonomy (`KNOWN_EVENT_TYPES`, 27 classes) mirrors the **BW Ministry of the Interior crisis catalogue** (natural hazards, tech/industrial, CBRN, pandemic, terrorism/security, supply crises, evacuations); the LLM classifier and `frontend/src/lib/eventMeta.tsx` are constrained/synced to it.
- **Schemas** — `schemas.py`: Pydantic models `RawReport`, `SourceReport`, `VerifiedIncident`, `DebunkedReport` (frontend mirror: `frontend/src/lib/types.ts` — keep in sync).
- **Live ingestion** — `backend/ingestion/`: keyless real-data connectors (NINA civil-protection warnings, Presseportal police RSS, Mastodon hashtags) with event classifier, scope-aware gazetteer/Nominatim geocoding, and a SQLite store (`backend/data/`, gitignored). Opt-in via `FEEDS_ENABLED=true` in `backend/.env` — the synthetic mock feed stays the offline default. Every live item flows through the same credibility filter + clustering. Runtime search scopes live in `ingestion/scopes.py` (`konstanz-sector` default, Germany, USA, EU, 16 German states, 50 US states) and are switched through `GET /api/scopes` / `POST /api/scope`, which clears live data and reconfigures geocoding + stream prefilters.
- **Real-time streaming** — `ingestion/streaming.py` (+`FEEDS_STREAMING=true`): Mastodon WebSocket (multiplexed subscribes, follows streaming-host redirects, degrades to ~25 s short-poll on anonymous-stream rejection) and the Bluesky Jetstream firehose (hard client-side prefilter: active-scope keyword + language + crisis classifier). One consumer feeds streamed posts through the identical poll pipeline; debounced snapshot publish (2 s); ring-buffer ticker via `GET /api/stream/recent`; `MAX_STREAM_ANALYSES_PER_MIN` caps stream-triggered LLM spend on top of `LLM_MAX_CALLS`; exponential-backoff supervision keeps a dead stream from touching anything else. The classifier is DE/EN; non-DE/EN EU posts are under-detected, and NINA/Presseportal are Germany-only.
- **API** — `main.py`: `GET /api/incidents`, `GET /api/debunked`, `GET /api/health` (reports `ai_mode`, `data_mode`, active `scope`), `GET /api/scopes`, plus `POST /api/reports` (live injection), `POST /api/reset` (demo reset), `POST /api/poll` (trigger a live ingestion cycle), and `POST /api/scope` (runtime scope switch); CORS open for `localhost:3000`.

### Frontend — Next.js (`frontend/`)
- **React 19 + Tailwind v4** App Router, TypeScript, `src/` layout. Design tokens (signal palette, glass panels, motion keyframes) live in `src/app/globals.css` (`@theme` / `@utility`); reduced-motion is honored globally.
- **Leaflet / React-Leaflet** — `src/components/Map.tsx`, client-side-only (dynamic import, `ssr: false`): red pins + 1 km rings on a CARTO dark basemap, hover/select cross-highlighting, fly-to controller, pulse rings on new incidents, amber DEBUNKED flash pin for hoaxes.
- **Sidebar** — `src/components/Sidebar.tsx`: tabs **Live Incidents** / **Disinfo Caught** (flag-rule badges + `reason_flagged`), swaps to `IncidentDetail.tsx` (dossier: confidence gauge, severity, action hint, source timeline) on selection.
- **SITREP layer** — `KpiStrip.tsx` (count-up KPIs + type breakdown), `FilterChips.tsx` (filters map + lists), `Toasts.tsx` (verdict notifications), `DemoControls.tsx` (collapsible scenario injector via `src/lib/presets.ts`).
- **Data layer** — `src/hooks/useDashboard.ts`: single poll loop (5 s) + on-demand refresh returning a snapshot; also fetches `/api/scopes` and posts runtime scope changes for the CrisisLens header picker/map bounds. `useCountUp.ts` handles animated numbers; shared event metadata lives in `src/lib/eventMeta.tsx`. UI state (selection, filter, tab, focus) is composed in `src/app/page.tsx`.

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
