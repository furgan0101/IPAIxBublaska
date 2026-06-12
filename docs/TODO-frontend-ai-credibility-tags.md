# TODO (frontend): surface AI credibility + clickable tag filter

Backend is **done and live** — the API now exposes everything the UI needs. This doc is the
remaining frontend wiring, deferred on purpose (the CrisisLens frontend is mid-merge). Pick it up
once the merge is committed.

## What the backend already gives you (verified)

`GET /api/incidents` (`VerifiedIncident`) and `GET /api/debunked` (`DebunkedReport`) now carry:

- `VerifiedIncident.ai_credibility: float | null` — **mean** of the clustered sources' AI-analyst
  credibility (0–1), **distinct** from `confidence_score` (which is corroboration/clustering only).
  `null` in mock/heuristic mode (no LLM ran). Verified live: a 2-source flood cluster returned
  `ai_credibility=0.86` while `confidence_score=0.74`.
- `SourceReport.ai_credibility: float | null` — per-source AI score (already alongside the existing
  `ai_rationale` / `ai_media_note` / `media_preview`).
- `DebunkedReport` already exposes the AI score as `credibility_score` (+ `rationale`,
  `media_consistency`, `media_preview`).

Backend source of truth: `backend/schemas.py`, aggregation in
`backend/logic/geospatial.py` (`_mean_ai_credibility`), stamped in
`backend/logic/verification.py` (`annotate_report`, gated on a live LLM rationale being present).

---

## Change 3 — show AI credibility on the dossier

1. **`frontend/src/lib/types.ts`** — add the optional fields (mirrors `schemas.py`):
   - `SourceReport`: `ai_credibility?: number | null;`
   - `VerifiedIncident`: `ai_credibility?: number | null;`

2. **`frontend/src/lib/mockReports.ts`** — add `aiCredibility?: number | null;` to the
   `CrisisReport` interface. (Optionally seed a few mock reports with a value so the mock demo shows it.)

3. **`frontend/src/lib/liveAdapter.ts`**
   - `adaptIncident`: set
     `aiCredibility: incident.ai_credibility != null ? Math.round(incident.ai_credibility * 100) : null`.
   - `adaptDebunked`: AI credibility is already `confidence` (from `credibility_score`); set
     `aiCredibility: Math.round(report.credibility_score * 100)` if you want the field populated there too.

4. **`frontend/src/components/crisislens/DetailPanel.tsx`** — disambiguate the two scores:
   - The existing `ConfidenceRing` is fed by `report.confidence` = **corroboration** confidence.
     Relabel its `SectionLabel` from "AI-assisted confidence" to **"Corroboration confidence"**.
   - Add a distinct **"AI plausibility"** stat (only when `report.aiCredibility != null`), e.g. as a third
     card in the existing `grid-cols-2` stats `<section>` next to "Risk level" / "Location confidence",
     rendering `{report.aiCredibility}%`. Keep wording advisory (it is an AI estimate).

   Note the per-source `ai_credibility` is also available on each `SourceReport` if you want to show a
   small score chip per evidence row (optional).

---

## Change 4 — clickable event-type tag filter at the top (CrisisLens has none today)

File: **`frontend/src/components/crisislens/Dashboard.tsx`** + a new
**`frontend/src/components/crisislens/TagFilter.tsx`**.

1. New `TagFilter` component: props `{ tags: {tag: string; count: number}[]; active: string | null;
   onChange: (t: string | null) => void }`. Render an "All" chip + one chip per tag with its count.
   Reuse `EventIcon` / `eventMeta` from `@/lib/eventMeta` for icon+colour where the tag maps to a known
   event type (note: chips group on `CrisisReport.crisisType`, the human label — map back via the label
   or just show the label text). Style to match CrisisLens (`border-border`, `bg-card`, gold active
   state) rather than the legacy `FilterChips.tsx` cyan theme.

2. In `Dashboard.tsx`:
   - Add `const [activeTag, setActiveTag] = useState<string | null>(null);`
   - Derive distinct tags + counts from `reports` (memoized) by `crisisType`.
   - Apply the filter **before** the existing derived memos so map + signals + stats all follow it:
     `const visibleReports = useMemo(() => activeTag ? reports.filter(r => r.crisisType === activeTag) : reports, [reports, activeTag]);`
     then feed `visibleReports` into `selected`, `stats`, `feed`, and `<CrisisMap reports=...>`.
   - Render `<TagFilter ... />` as a horizontal bar at the top of the map `<main>` column (absolute,
     like the legacy chips) or just above the "Latest Signals" rail.
   - Clear `activeTag` (and/or `selectedId`) appropriately; keep Escape behaviour.

Legacy reference (do not mount, just for markup ideas): `frontend/src/components/FilterChips.tsx`.

---

## Verification (after wiring)

- `cd frontend && npm run lint && npm run build` stays green.
- `npm run dev`, open http://localhost:3000?dashboard : tag chips at the top filter map + signals +
  stats; selecting a live incident shows **AI plausibility** separate from **corroboration confidence**.
- Cross-check a number against the API: `curl -s localhost:8000/api/incidents | jq '.[0] |
  {confidence_score, ai_credibility}'`.
