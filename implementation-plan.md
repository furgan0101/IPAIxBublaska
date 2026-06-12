# Implementation Plan — VOSTbw OSINT Situational Awareness Dashboard

## Execution rule (STRICT)

Execute **one step at a time, in order**. Do **not** begin a step until the previous step is
finished and explicitly confirmed. Every step obeys the guardrails in `CLAUDE.md`:

- Happy-path demo first; mock data until the final integration step (Step 6).
- Strict JSON / Pydantic schemas everywhere the LLM output is parsed.
- Keep ingestion · AI verification · API routing cleanly separated.

## Status tracker

> 2026-06-12: Steps 1–5 delivered in a single autonomous MVP build (see README.md).

- [x] **Step 1 — Core Schemas & Mocking**
- [x] **Step 2 — The VOST AI Filter** *(mock heuristics; API-key drop-in marked in `logic/verification.py`)*
- [x] **Step 3 — Verification Engine**
- [x] **Step 4 — API Layer**
- [x] **Step 5 — Frontend Dashboard**
- [ ] **Step 6 — Live Wire**  ← NEXT

---

## Step 1 — Core Schemas & Mocking
Define the Pydantic models for **`RawReport`**, **`VerifiedIncident`**, and **`DebunkedReport`**.
Then trigger the **`generate-vost-mocks`** skill to produce `mock_data.json`.

- **Deliverables:** backend Pydantic models; `mock_data.json` matching the ingestion schema.
- **Skill:** `generate-vost-mocks`
- **Done when:** models import cleanly and `mock_data.json` validates against `RawReport`.

## Step 2 — The VOST AI Filter
Implement the LLM parsing logic to extract **event type**, **location**, and assign a
**credibility score**.

- **Guardrail:** enforce a strict JSON output schema; mock the LLM response (no live API).
- **Done when:** a raw mock report is parsed into a structured, validated object with a score.

## Step 3 — Verification Engine
- **Temporal verification:** EXIF/timestamp checks to catch old/recycled footage.
- **Spatial verification:** group reports within a **1 km radius** occurring within a
  **60-minute window**.

- **Skill:** `verify-ai-pipeline` (test schema + radius math without live APIs).
- **Done when:** clustered corroborating reports → `VerifiedIncident`; stale/conflicting → `DebunkedReport`.

## Step 4 — API Layer
Expose the FastAPI endpoints *(paths finalised in the MVP build)*:

- `GET /api/incidents` → verified incidents
- `GET /api/debunked`  → caught disinformation
- `GET /api/health`    → pipeline stats + AI mode (`mock` / `live-ready`)

- **Done when:** both endpoints return correctly shaped JSON sourced from the verification engine (mock-backed).

## Step 5 — Frontend Dashboard
Scaffold the Next.js app. Integrate Leaflet. Render the live map **and** a dedicated
**"Disinformation Caught"** side-panel.

- **Skill:** `sync-dashboard` (verify fetch + conditional marker formatting; lint for hydration/hook errors).
- **Marker convention:** Red = verified crisis · Gray = debunked/misinfo.
- **Done when:** the map plots active incidents and the side-panel lists debunked reports from the API.

## Step 6 — Live Wire
Connect a **real ingestion source** (e.g., a Telegram channel or a simulated live RSS feed) to the
pipeline. This is the final integration step where mocks are switched off.

- **Done when:** a live/simulated feed flows end-to-end through ingestion → AI filter → verification → API → map.
