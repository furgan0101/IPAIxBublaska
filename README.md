# VOSTbw — Automated OSINT Situational Awareness Dashboard

Hackathon MVP for **VOST Baden-Württemberg**: ingests raw OSINT posts (tweets, Telegram, Mastodon), runs them through an AI credibility filter and a geospatial verification engine, then plots **verified incidents** on a live Konstanz map — and proudly shows the **disinformation it caught**, with the reason each report was flagged.

```
mock_data.json ──> ingestion ──> AI credibility filter ──> geo-clustering ──> FastAPI ──> Next.js map
 (8 raw posts)     RawReport      bot-spam / stale EXIF      1.0 km radius     :8000        :3000
                                  / geotag conflicts         60 min window
```

## Requirements

- Python **3.10+**
- Node.js **18.18+**

## Quick start (one line per step, from the repo root)

| # | Command | What it does |
|---|---------|--------------|
| 1 | `npm install` | installs the root dev-server runner (`concurrently`) |
| 2 | `npm run setup` | installs backend (pip) **and** frontend (npm) dependencies |
| 3 | `npm run dev` | starts **both** servers concurrently — API on :8000, dashboard on :3000 |

Then open **http://localhost:3000**.

### Individual servers (fallback)

```
cd backend && python -m uvicorn main:app --reload --port 8000
```

```
cd frontend && npm run dev
```

### Backend tests

```
npm run test:api
```

## URLs

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API — verified incidents | http://localhost:8000/api/incidents |
| API — disinformation caught | http://localhost:8000/api/debunked |
| API — health / AI mode | http://localhost:8000/api/health |
| Interactive API docs (Swagger) | http://localhost:8000/docs |

## How verification works (all metric)

A raw report is **debunked** if any rule fires:

| Rule | Threshold | Catches |
|---|---|---|
| Bot-spam phrasing | known marker list | amplification networks ("SHARE BEFORE THEY DELETE…") |
| Recycled footage | media EXIF > **48 h** older than the post | old flood/fire videos re-posted as breaking news |
| Geotag conflict | media EXIF geotag > **5 km** from claimed position | photos taken in a different city |

Surviving reports are **clustered**: same event type, within a **1.0 km radius** of the cluster centroid, within a **60 min** window of another member → merged into one `VerifiedIncident`. Confidence scales with the number of independent corroborating sources.

## Demo script (for judges)

1. `npm run dev` → open http://localhost:3000.
2. **Map**: two red incident pins in Konstanz (flood at the Seestraße/Hafen waterfront — 3 corroborating sources; roof fire in the Niederburg — 2 sources), each with its 1 km verification ring. Click a pin for confidence + sources.
3. **Sidebar → Disinformation Caught**: 3 flagged posts, each with the exact AI-filter reason — recycled 2019 flood video (stale EXIF), bot-spam "dam burst" panic post, and a "Bahnhof fire" photo whose EXIF geotag is 124 km away in Stuttgart.
4. `GET /api/health` → shows `"ai_mode": "mock"`; drop an `ANTHROPIC_API_KEY` into `backend/.env` and it reports `live-ready` (key drop-in point: `backend/logic/verification.py`).

## Notes

- **All feed data is synthetic** (`backend/mock_data.json`) — fictional accounts, posts, and media. Timestamps are rebased to "now" at backend startup so the demo always looks live.
- **No external AI/geocoding calls** are made in mock mode (hackathon guardrail — no rate limits, no burned credits).
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors © [CARTO](https://carto.com/attributions) (network access required for tiles).
- Next step (planned): **Step 6 — Live Wire**, swapping `mock_data.json` for a real Telegram/RSS ingestion source. See `implementation-plan.md`.
