# PERF_NOTES - branch `feature/sources-confidence-perf`

Performance + animation pass. What was applied here (additive, no owned bug
code touched), plus the high-impact changes that live in collaborator-owned
files and are left as recommendations.

## Applied in this branch
- next.config.ts: `experimental.optimizePackageImports: ["lucide-react"]`
  (tree-shakes the icon barrel used across many components), plus
  `poweredByHeader:false` and `compress:true`.
- globals.css (append only): a complete `@media (prefers-reduced-motion: reduce)`
  block (there was none, so the infinite pin pulses previously ran regardless
  of the OS setting), a scoped `will-change` on the selected pulse ring, a
  `.cl-gpu` hint, and a `.cl-virtualise` (content-visibility) utility for long
  lists.
- app/loading.tsx, error.tsx, not-found.tsx: instant route feedback, a contained
  error boundary, and a branded 404 (all transform/opacity animation only).
- app/manifest.ts: installable PWA manifest.

## Build size (production `next build`, First Load JS)
| Route        | Before  | After   |
| ------------ | ------- | ------- |
| /            | 159 kB  | 160 kB  |
| /_not-found  | 104 kB  | 103 kB  |
| /analytics   | 126 kB  | 127 kB  |
| shared chunks| 103 kB  | 103 kB  |

The main route is dominated by Leaflet + the dashboard, so the bundle delta is
small; `optimizePackageImports` shows most on lighter routes and on dev/runtime
icon resolution. The largest *runtime* smoothness wins are the reduced-motion
block (stops hundreds of always-on pin pulses) and the recommendations below.

## Recommendations (live in collaborator-owned files; NOT changed here)
1. CrisisMap.tsx: set `preferCanvas: true` on `<MapContainer>` and add marker
   clustering once statewide ingestion yields hundreds of pins. DOM markers do
   not scale; this is the single biggest map smoothness win.
2. CrisisMap.tsx: the `.cl-node-ring` pulse animates on EVERY pin continuously.
   Limit it to the selected/hovered pin (or pins in view) so idle pins are
   static dots. Huge compositor saving at statewide scale.
3. Dashboard.tsx: the signals rail and command console collapse by animating
   `width` (style={{ width }} + transition-[width]), which reflows every frame.
   Animate `transform` (translate) or `flex-basis`, or use a CSS grid-column
   transition, to move it off the main thread.
4. hooks/useDashboard.ts: the 5 s poll calls setState every cycle even when the
   payload is unchanged, replaying mount animations and re-running memos.
   Deep-equal the new incidents/debunked against the last and skip the update
   when identical (keep referential identity stable).
5. Landing.tsx: replace the `<img>` hero with next/image for LCP (already an
   eslint warning).
6. Dashboard.tsx: apply the new `.cl-virtualise` class to each news-feed `<li>`
   so off-screen rows skip layout + paint.
7. next.config.ts: enable `reactStrictMode: true` once the Command Mode map
   effects are settled (omitted now so it does not double-fire effects during
   live dev debugging).
8. Add real PWA icons (192/512 px, maskable) to make app/manifest.ts installable.
