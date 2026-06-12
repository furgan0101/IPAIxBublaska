"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Activity, RotateCcw, ScanEye } from "lucide-react";

import {
  MOCK_REPORTS,
  STATUS_META,
  type CrisisReport,
} from "@/lib/mockReports";
import { timeAgo } from "@/lib/format";
import DetailPanel from "./DetailPanel";

// Leaflet touches `window` — load the map strictly client-side.
const CrisisMap = dynamic(() => import("./CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="cl-grid-bg flex h-full w-full items-center justify-center bg-night-950 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
      Loading Baden-Württemberg sector map…
    </div>
  ),
});

const ANALYSIS_REFRESH_MS = 30_000;

/** Main command-center view: map, stats, signal feed and report dossier. */
export default function Dashboard() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<Date>(() => new Date());

  const selected = useMemo(
    () => MOCK_REPORTS.find((r) => r.id === selectedId) ?? null,
    [selectedId],
  );

  // Mock "pipeline re-run" heartbeat for the top bar.
  useEffect(() => {
    const timer = setInterval(
      () => setLastAnalysis(new Date()),
      ANALYSIS_REFRESH_MS,
    );
    return () => clearInterval(timer);
  }, []);

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
      MOCK_REPORTS.filter((r) => r.status === s).length;
    const avg = Math.round(
      MOCK_REPORTS.reduce((sum, r) => sum + r.confidence, 0) /
        MOCK_REPORTS.length,
    );
    return [
      { label: "Active Reports", value: `${MOCK_REPORTS.length}`, sub: "in current window", accent: "#64748b" },
      { label: "Relevant Crises", value: `${count("relevant")}`, sub: "evidence-based escalation", accent: STATUS_META.relevant.color },
      { label: "Needs Review", value: `${count("review")}`, sub: "human review required", accent: STATUS_META.review.color },
      { label: "Ignored Signals", value: `${count("ignored")}`, sub: "insufficient corroboration", accent: STATUS_META.ignored.color },
      { label: "Avg. Confidence", value: `${avg}%`, sub: "AI-assisted plausibility", accent: "#38bdf8" },
    ];
  }, []);

  const feed = useMemo(
    () =>
      [...MOCK_REPORTS].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [],
  );

  return (
    <div className="cl-fade-in flex h-screen flex-col overflow-hidden bg-night-950">
      {/* ------------------------------------------------------- top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-night-700 bg-night-900/90 px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-red-500/40 bg-red-500/10">
            <ScanEye className="h-4.5 w-4.5 text-red-400" />
          </span>
          <span className="font-display text-xl font-semibold tracking-[0.1em]">
            CRISIS<span className="text-red-500">LENS</span>
          </span>
        </div>

        <span className="hidden h-5 w-px bg-night-700 md:block" aria-hidden />
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 md:block">
          Baden-Württemberg sector
        </span>

        <div className="ml-auto flex items-center gap-4">
          <span className="hidden items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Monitoring Live
            </span>
          </span>

          <span className="hidden font-mono text-[11px] tabular-nums text-slate-500 lg:block">
            LAST ANALYSIS{" "}
            <span className="text-slate-300">
              {lastAnalysis.toLocaleTimeString("de-DE")}
            </span>
          </span>

          {selected && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-2 rounded-md border border-night-600 bg-night-800 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset View
            </button>
          )}
        </div>
      </header>

      {/* --------------------------------------------------- stats strip */}
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-night-700 bg-night-700 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center gap-3.5 bg-night-900 px-5 py-3"
          >
            <span
              className="h-9 w-1 shrink-0 rounded-full"
              style={{ background: stat.accent }}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {stat.label}
              </p>
              <p className="font-display text-2xl font-semibold leading-7 tabular-nums">
                {stat.value}
              </p>
              <p className="truncate text-[10px] text-slate-600">{stat.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ----------------------------------------------------- main row */}
      <div className="flex min-h-0 flex-1">
        {/* Latest signals rail */}
        <aside className="hidden w-[290px] shrink-0 flex-col border-r border-night-700 bg-night-900/70 lg:flex">
          <div className="flex items-center gap-2 border-b border-night-700 px-4 py-3">
            <Activity className="h-4 w-4 text-red-400" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              Latest Signals
            </h2>
            <span className="ml-auto rounded-full bg-night-700 px-2 py-0.5 font-mono text-[10px] text-slate-400">
              {feed.length}
            </span>
          </div>

          <div className="cl-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <ul className="space-y-2">
              {feed.map((report) => {
                const meta = STATUS_META[report.status];
                const isSelected = report.id === selectedId;
                return (
                  <li key={report.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(report.id)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-slate-400/60 bg-night-800"
                          : "border-night-700 bg-night-850 hover:border-night-600 hover:bg-night-800"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                          aria-hidden
                        />
                        <span className="truncate text-xs font-semibold text-slate-200">
                          {report.city} · {report.crisisType}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                          {timeAgo(report.timestamp)}
                        </span>
                      </span>
                      <span className="mt-1.5 line-clamp-2 block text-[11px] leading-snug text-slate-400">
                        “{report.signalSnippet}”
                      </span>
                      <span className="mt-1.5 block truncate text-[10px] text-slate-600">
                        {report.signalSource}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="border-t border-night-700 px-4 py-3 text-[10px] leading-relaxed text-slate-600">
            AI-assisted plausibility estimates on synthetic data. Human review
            required before escalation.
          </p>
        </aside>

        {/* Map column */}
        <main className="relative min-w-0 flex-1">
          <CrisisMap
            reports={MOCK_REPORTS}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          {/* Triage legend */}
          <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded-lg border border-night-700 bg-night-900/90 px-3.5 py-2.5 shadow-lg backdrop-blur">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              AI-assisted triage
            </p>
            <ul className="mt-1.5 space-y-1">
              {(
                Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]
              ).map((status) => (
                <li
                  key={status}
                  className="flex items-center gap-2 text-[11px] text-slate-300"
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
