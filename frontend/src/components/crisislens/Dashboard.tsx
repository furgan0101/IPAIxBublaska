"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Activity, RotateCcw } from "lucide-react";

import { STATUS_META, type CrisisReport } from "@/lib/mockReports";
import { useLiveReports, type DataMode } from "@/hooks/useLiveReports";
import { timeAgo } from "@/lib/format";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";
import DetailPanel from "./DetailPanel";

// Leaflet touches `window` — load the map strictly client-side.
const CrisisMap = dynamic(() => import("./CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
      Loading Baden-Württemberg sector map…
    </div>
  ),
});

const MODE_META: Record<
  DataMode,
  { label: string; dot: string; chip: string }
> = {
  live: {
    label: "Live data",
    dot: "bg-emerald-500",
    chip: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  "backend-demo": {
    label: "Demo feed",
    dot: "bg-gold-fill",
    chip: "border-yellow-600/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  },
  "offline-demo": {
    label: "Demo · offline",
    dot: "bg-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
  },
  connecting: {
    label: "Connecting…",
    dot: "bg-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
  },
};

interface DashboardProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

/** Main command-center view: map, stats, signal feed and report dossier. */
export default function Dashboard({ theme, onToggleTheme }: DashboardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { reports, mode, aiMode, lastUpdated } = useLiveReports();

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  // Drop the selection if the polled data no longer contains it.
  useEffect(() => {
    if (selectedId && !reports.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [reports, selectedId]);

  // Escape resets the view, mirroring the Reset View button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = useMemo(() => {
    const count = (s: CrisisReport["status"]): number =>
      reports.filter((r) => r.status === s).length;
    const avg = reports.length
      ? Math.round(
          reports.reduce((sum, r) => sum + r.confidence, 0) / reports.length,
        )
      : 0;
    return [
      { label: "Active Reports", value: `${reports.length}`, sub: "in current window", accent: "var(--muted-foreground)" },
      { label: "Relevant Crises", value: `${count("relevant")}`, sub: "evidence-based escalation", accent: STATUS_META.relevant.color },
      { label: "Needs Review", value: `${count("review")}`, sub: "human review required", accent: STATUS_META.review.color },
      { label: "Ignored Signals", value: `${count("ignored")}`, sub: "insufficient corroboration", accent: STATUS_META.ignored.color },
      { label: "Avg. Confidence", value: `${avg}%`, sub: "AI-assisted plausibility", accent: "var(--gold-fill)" },
    ];
  }, [reports]);

  const feed = useMemo(
    () =>
      [...reports].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [reports],
  );

  const modeMeta = MODE_META[mode];

  return (
    <div className="cl-fade-in flex h-screen flex-col overflow-hidden bg-background">
      {/* Flag rule across the top edge. */}
      <div className="flex h-1 shrink-0 flex-col" aria-hidden>
        <div className="flex-1 bg-black" />
        <div className="flex-1 bg-gold-fill" />
      </div>

      {/* ------------------------------------------------------- top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
        <div className="flex items-center gap-3">
          <BwFlag />
          <span className="font-display text-lg font-semibold tracking-[0.08em]">
            CRISISLENS
          </span>
        </div>

        <span className="hidden h-5 w-px bg-border md:block" aria-hidden />
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground md:block">
          Baden-Württemberg sector
        </span>

        <div className="ml-auto flex items-center gap-3">
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1 ${modeMeta.chip}`}
            title={
              aiMode
                ? `AI analyst: ${aiMode}`
                : "Backend status unknown"
            }
          >
            <span className="relative flex h-2 w-2">
              {mode === "live" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${modeMeta.dot}`}
              />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
              {modeMeta.label}
            </span>
          </span>

          <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground lg:block">
            Last analysis{" "}
            <span className="text-foreground">
              {lastUpdated ? lastUpdated.toLocaleTimeString("de-DE") : "—"}
            </span>
          </span>

          {selected && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset View
            </button>
          )}

          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </header>

      {/* --------------------------------------------------- stats strip */}
      {/* Collapses when a node is selected → focused map | dossier split. */}
      <div
        className="shrink-0 overflow-hidden transition-all duration-500 ease-in-out"
        style={{ maxHeight: selected ? 0 : 200, opacity: selected ? 0 : 1 }}
        aria-hidden={Boolean(selected)}
      >
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-4 bg-background px-6 py-4"
          >
            <span
              className="h-10 w-1 shrink-0 rounded-full"
              style={{ background: stat.accent }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {stat.label}
              </p>
              <p className="font-display text-3xl font-semibold leading-8 tabular-nums">
                {stat.value}
              </p>
              <p className="truncate text-[11px] text-muted-foreground/70">
                {stat.sub}
              </p>
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* ----------------------------------------------------- main row */}
      <div className="flex min-h-0 flex-1">
        {/* Latest signals rail — collapses away when a node is selected. */}
        <aside
          className="hidden shrink-0 overflow-hidden transition-[width] duration-500 ease-in-out lg:block"
          style={{ width: selected ? 0 : 300 }}
          aria-hidden={Boolean(selected)}
        >
          <div className="flex h-full w-[300px] flex-col border-r border-border bg-background">
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
            <Activity className="h-4 w-4 text-gold" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
              Latest Signals
            </h2>
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {feed.length}
            </span>
          </div>

          <div className="cl-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {feed.length === 0 ? (
              <div className="mt-6 px-3 text-center text-xs leading-relaxed text-muted-foreground">
                No signals in the current window. The pipeline is watching the
                live feeds.
              </div>
            ) : (
              <ul className="space-y-2">
                {feed.map((report) => {
                  const meta = STATUS_META[report.status];
                  const isSelected = report.id === selectedId;
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(report.id)}
                        className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                          isSelected
                            ? "border-gold bg-muted"
                            : "border-border bg-card hover:bg-muted/60"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                            aria-hidden
                          />
                          <span className="truncate text-xs font-semibold text-foreground">
                            {report.city} · {report.crisisType}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                            {timeAgo(report.timestamp)}
                          </span>
                        </span>
                        <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                          “{report.signalSnippet}”
                        </span>
                        <span className="mt-1.5 block truncate text-[10px] text-muted-foreground/70">
                          {report.signalSource}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="border-t border-border px-5 py-3.5 text-[11px] leading-relaxed text-muted-foreground">
            AI-assisted plausibility estimates. Human review required before
            escalation.
          </p>
          </div>
        </aside>

        {/* Map column */}
        <main className="relative min-w-0 flex-1">
          <CrisisMap
            reports={reports}
            selectedId={selectedId}
            onSelect={setSelectedId}
            theme={theme}
          />

          {/* Triage legend */}
          <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded-lg border border-border bg-card/95 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              AI-assisted triage
            </p>
            <ul className="mt-2 space-y-1.5">
              {(
                Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]
              ).map((status) => (
                <li
                  key={status}
                  className="flex items-center gap-2.5 text-xs text-foreground"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${STATUS_META[status].dot}`}
                    aria-hidden
                  />
                  {STATUS_META[status].badge}
                </li>
              ))}
            </ul>
          </div>
        </main>

        {/* Report dossier */}
        <DetailPanel report={selected} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}
