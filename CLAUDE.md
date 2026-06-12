# CLAUDE.md

Global system prompt and operating guide for the **Automated OSINT Situational Awareness Dashboard** — a hackathon project for **VOSTbw** (Virtual Operations Support Team Baden-Württemberg). The system ingests open-source crisis reports, runs an AI credibility filter plus temporal/spatial verification to separate real incidents from disinformation, and plots the result on a live map. Demo sector: **Konstanz** (47.6603 N, 9.1758 E).

---

## Project Architecture

### Backend — Python / FastAPI (`backend/`)
- **AI orchestration** — `logic/verification.py`: credibility filter (mock heuristics standing in for LLM + Vision calls; clearly marked API-key drop-in point, `ANTHROPIC_API_KEY` via `backend/.env`).
- **EXIF-based checks** — stale capture timestamps (recycled footage) and conflicting geotags, parsed from report metadata.
- **Geospatial** — `logic/geospatial.py`: **Geopy** geodesic clustering (same event type + **1.0 km radius** + **60 min window** → one `VerifiedIncident`). PostGIS is the scale-up path once a real DB lands; the MVP is in-memory.
- **Schemas** — `schemas.py`: Pydantic models `RawReport`, `VerifiedIncident`, `DebunkedReport`.
- **API** — `main.py`: `GET /api/incidents`, `GET /api/debunked`, `GET /api/health`; CORS open for `localhost:3000`.

### Frontend — Next.js (`frontend/`)
- **React 19 + Tailwind v4** App Router, TypeScript, `src/` layout.
- **Leaflet / React-Leaflet** — `src/components/Map.tsx`, client-side-only (dynamic import, `ssr: false`), red pins + 1 km radius rings, CARTO dark basemap.
- **Sidebar** — `src/components/Sidebar.tsx`: tabs **Live Incidents** / **Disinformation Caught** (the latter highlights `reason_flagged`).

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
3. **Use mock data for LLM and Vision APIs** to prevent rate-limiting and burned credits — never hit live LLM/geocoding APIs during UI testing. **But structure the code so API keys can be dropped in later**: the swap point lives in `logic/verification.py` (`ANTHROPIC_API_KEY` in `backend/.env`; `/api/health` reports `mock` vs `live-ready`).
4. **Always use the metric system.** Kilometres, metres, °C — in code, UI copy, and docs.
5. **Strict JSON output schemas** for all AI-filter logic: constrain the model, validate with Pydantic, fail loudly — no parsing crashes.
6. **Clean pipeline separation** between data ingestion, AI verification (temporal/spatial checks), and API routing.

---

## Skills

- **`verify-ai-pipeline`** — run backend tests for the extraction schema + 1 km radius math, no live APIs.
- **`generate-vost-mocks`** — regenerate the synthetic Konstanz feed in `backend/mock_data.json`.
- **`sync-dashboard`** — verify the frontend fetches/plots backend data; check marker formatting + lint.
