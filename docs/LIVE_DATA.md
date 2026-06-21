# Live Data Ingestion — Real OSINT Feeds

The dashboard can run against **real open-data sources** instead of the
synthetic mock feed. Live mode is a pure config flip and changes nothing about
the API contract — the frontend works unmodified.

```bash
# backend/.env
FEEDS_ENABLED=true
```

Then `npm run dev` as usual. `/api/health` reports `"data_mode": "live"` plus
per-connector status. Without the flag, the mock feed is served exactly as
before, and pytest stays fully offline (connectors are tested against recorded
fixtures via `httpx.MockTransport` — zero network).

## Sources (all keyless)

| Connector | What | Default scope |
|---|---|---|
| **NINA** (`ingestion/nina.py`) | Official German civil-protection warnings — MoWaS, KATWARN, BIWAPP, DWD, police — via the BBK `api31` dashboard | Landkreis Konstanz (ARS `083350000000`) |
| **Presseportal** (`ingestion/presseportal.py`) | Police/fire press releases ("Blaulicht" RSS) | Polizeipräsidium Konstanz (`dienststelle_110973`; covers the districts KN, TUT, RW, VS) |
| **Mastodon** (`ingestion/mastodon.py`) | Public hashtag timelines — the channel where citizen reports *and* disinformation live; deliberately un-curated, judging posts is the credibility filter's job | `mastodon.social`: #konstanz #bodensee #hochwasser #unwetter |

> Bluesky's public AppView returns 403 from this network, so Mastodon is the
> social channel. Adding another connector = one file implementing
> `ingestion.base.Connector` + one line in `service.default_connectors`.

## Pipeline per poll cycle (every `FEEDS_POLL_INTERVAL_S`, default 120 s)

```
fetch all connectors concurrently        (per-connector failure isolation)
  -> classify     ingestion/classify.py  DE/EN keywords -> 27-class BW taxonomy
                                         (no crisis class -> dropped)
  -> geocode      ingestion/geocode.py   offline gazetteer first; structured
                                         "(Ort / Lkr. X)" hints may escalate to
                                         Nominatim (cached, 1 req/s, bounded to
                                         the sector viewbox — OSM policy)
  -> sector gate  geodesic distance to SECTOR_LAT/LON <= SECTOR_RADIUS_KM
  -> dedup        SQLite: upstream key + normalised content hash
  -> verify       logic/verification.py  same heuristics + optional live LLM
  -> persist      backend/data/livefeeds.db (gitignored; survives restarts)
  -> publish      rebuild last FEEDS_RETENTION_HOURS -> cluster (1 km/60 min)
                  -> source-trust floor -> swap in-memory API snapshot
```

**Source-trust floor:** a cluster containing an official channel gets at least
that channel's confidence — NINA 0.90, Presseportal 0.80 — and no
"Low corroboration" hint (a federal warning or police release is already
authority-verified). Social-only clusters keep the corroboration-count score.

**Location discipline:** "Polizei Konstanz: (Talheim, …)" names the *agency*
before the *location* — structured place hints are therefore resolved fully
(gazetteer → Nominatim) before any free-text place scan, so reports pin to the
incident town, not the agency seat. Unlocatable reports are dropped, never
guessed (exception: a district-wide NINA warning without CAP geometry pins to
the sector centre, because the polled region *is* its area).

## Configuration (backend/.env — all optional)

| Variable | Default | Meaning |
|---|---|---|
| `FEEDS_ENABLED` | `false` | Master switch for live ingestion |
| `FEEDS_POLL_INTERVAL_S` | `120` | Poll cadence (min 30) |
| `FEEDS_RETENTION_HOURS` | `24` | Serving window; raise for a fuller map |
| `SECTOR_LAT` / `SECTOR_LON` | Konstanz | Sector centre |
| `SECTOR_RADIUS_KM` | `40` | Spatial gate (km, metric) |
| `NINA_ARS` | `083350000000` | Comma-separated 12-digit region keys |
| `PRESSEPORTAL_FEEDS` | PP Konstanz | Comma-separated RSS URLs |
| `MASTODON_INSTANCE` | `mastodon.social` | Any Mastodon-compatible instance |
| `MASTODON_TAGS` | `konstanz,bodensee,…` | Comma-separated hashtags |
| `NOMINATIM_ENABLED` | `true` | Fallback geocoding for unknown place hints |
| `FEEDS_DB_PATH` | `data/livefeeds.db` | SQLite store (relative to backend/) |

`USE_LIVE_AI=true` composes with live feeds: every *new* report additionally
gets the LLM analyst's plausibility judgement (dedup ensures each upstream
post is assessed exactly once, so polling does not re-burn credits).

## API additions

- `POST /api/poll` — trigger one ingest cycle on demand; returns the funnel
  stats (`fetched / new_verified / new_debunked / duplicates / not_crisis /
  unlocated / off_sector / stale`).
- `GET /api/health` — adds `data_mode` (`mock`|`live`) and a `feeds` block
  (last poll, per-connector ok/fetched/error).
- `POST /api/reset` — in live mode wipes the store and re-polls immediately.
- `POST /api/reports` — manual demo injections are persisted in live mode, so
  they survive snapshot rebuilds and restarts (great for injecting a hoax on
  top of real data).
- Reports/sources now carry an optional `url` back to the original
  post/release (`schemas.py` + `types.ts`; UI can link it when desired).

## Expectations on a calm day

The funnel is honest: a quiet news day in a 40 km sector may yield only a
handful of verified incidents (e.g. one police accident release) and many
drops — that's the product working, not failing. There is no synthetic
fallback, so a calm day genuinely shows few or no incidents. For a denser
demo: raise `FEEDS_RETENTION_HOURS` / `SECTOR_RADIUS_KM`, add tags/feeds, or
inject a real report via `POST /api/reports`.

## Compliance notes

- **Nominatim**: identifying User-Agent, ≤1 req/1.1 s, hits *and* misses
  cached in SQLite, bounded queries — per the OSM usage policy.
- **NINA api31**: public open-data interface of the BBK.
- **Presseportal RSS**: public feeds; content remains © the issuing
  authorities/newsrooms — used here for internal situational awareness with
  source links preserved.
- **Mastodon**: public timelines via the documented public API.
