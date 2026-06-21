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
- **Live ingestion** — `backend/ingestion/`: the **single source of all served data**. Keyless real-data connectors (NINA civil-protection warnings, Presseportal police RSS, Mastodon hashtags) with event classifier, Konstanz gazetteer + rate-limited Nominatim fallback geocoding, and a SQLite store (`backend/data/`, gitignored). `IngestionService` polls on an interval at startup; every item flows through the same credibility filter + clustering. **There is no synthetic feed** — when the feeds are quiet the dashboard is legitimately empty. See `docs/LIVE_DATA.md`.
- **API** — `main.py`: `GET /api/incidents`, `GET /api/debunked`, `GET /api/health` (reports `ai_mode` and `data_mode`), plus `POST /api/reports` (inject one real report through the pipeline), `POST /api/reset` (wipe the live store + re-poll), and `POST /api/poll` (trigger an ingestion cycle on demand); CORS open for `localhost:3000`.

### Frontend — Next.js (`frontend/`)
- **React 19 + Tailwind v4** App Router, TypeScript, `src/` layout. Design tokens (signal palette, glass panels, motion keyframes) live in `src/app/globals.css` (`@theme` / `@utility`); reduced-motion is honored globally.
- **Leaflet / React-Leaflet** — `src/components/Map.tsx`, client-side-only (dynamic import, `ssr: false`): red pins + 1 km rings on a CARTO dark basemap, hover/select cross-highlighting, fly-to controller, pulse rings on new incidents, amber DEBUNKED flash pin for hoaxes.
- **Sidebar** — `src/components/Sidebar.tsx`: tabs **Live Incidents** / **Disinfo Caught** (flag-rule badges + `reason_flagged`), swaps to `IncidentDetail.tsx` (dossier: confidence gauge, severity, action hint, source timeline) on selection.
- **SITREP layer** — `KpiStrip.tsx` (count-up KPIs + type breakdown), `FilterChips.tsx` (filters map + lists), `Toasts.tsx` (verdict notifications).
- **Data layer** — `src/hooks/useDashboard.ts`: single poll loop (5 s) + on-demand refresh returning a snapshot, the **only** data source (real backend, no synthetic fallback); `src/lib/liveAdapter.ts` translates `VerifiedIncident`/`DebunkedReport` into the `CrisisReport` view model (`src/lib/reportTypes.ts`); shared event metadata in `src/lib/eventMeta.tsx`.

### Pipeline separation (keep these independently testable)
1. **Ingestion** — live connectors (`backend/ingestion/`) → validated `RawReport` list, published by `IngestionService`.
2. **AI verification** — credibility filter → geo-clustering (`logic/`).
3. **API routing** — thin FastAPI endpoints over the pipeline result.

```
.
├── backend/
│   ├── main.py            # FastAPI app + pipeline assembly
│   ├── schemas.py         # Pydantic models
│   ├── ingestion/         # live OSINT connectors + service + SQLite store
│   ├── logic/             # verification.py · geospatial.py · guidance.py
│   └── tests/             # pytest suite (rules, clustering, ingestion — offline)
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
3. **The running app uses real sources only** — live OSINT feeds + (by default) the live LLM analyst. **Tests are the exception:** pytest must stay green fully offline with **zero network calls** (connectors run against recorded fixtures; the LLM client is monkeypatched), and never hit live AI/geocoding APIs. The LLM is a pure config flip — `USE_LIVE_AI=false` falls back to the deterministic heuristic filter (real logic, no credits). `/api/health` reports `ai_mode` (`mock` / `live-ready` / `live`) and `data_mode`.
4. **Always use the metric system.** Kilometres, metres, °C — in code, UI copy, and docs.
5. **Strict JSON output schemas** for all AI-filter logic: constrain the model, validate with Pydantic, fail loudly — no parsing crashes.
6. **Clean pipeline separation** between data ingestion, AI verification (temporal/spatial checks), and API routing.

---

## Skills

- **`verify-ai-pipeline`** — run backend tests for the credibility rules + 1 km radius math, no live APIs.
- **`sync-dashboard`** — verify the frontend fetches/plots backend data; check marker formatting + lint.

> The `generate-vost-mocks` skill is **retired** — there is no synthetic feed anymore (real OSINT only, 2026-06-21).
