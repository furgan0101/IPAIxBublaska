"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3 } from "lucide-react";

import {
  MOCK_REPORTS,
  STATUS_META,
  type CrisisReport,
} from "@/lib/mockReports";
import { adaptAll } from "@/lib/liveAdapter";
import { useDashboard } from "@/hooks/useDashboard";
import BwFlag from "@/components/crisislens/BwFlag";
import ThemeToggle from "@/components/crisislens/ThemeToggle";
import ReportTimeline from "@/components/crisislens/ReportTimeline";

type Theme = "dark" | "light";
const THEME_KEY = "crisislens-theme";

export default function AnalyticsPage() {
  const [theme, setTheme] = useState<Theme>("dark");
  const { incidents, debunked, health, online } = useDashboard();

  useEffect(() => {
    let saved: Theme | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY) as Theme;
    } catch {
      // ignore
    }
    const activeTheme = saved === "light" ? "light" : "dark";
    setTheme(activeTheme);
    document.documentElement.classList.toggle("dark", activeTheme === "dark");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const mode = !online
    ? "offline"
    : health?.data_mode === "live"
      ? "live"
      : "mock";

  const reports: CrisisReport[] = useMemo(
    () =>
      mode === "live"
        ? adaptAll(incidents ?? [], debunked ?? [])
        : MOCK_REPORTS,
    [mode, incidents, debunked],
  );

  // Per-status breakdown for the summary cards.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { relevant: 0, review: 0, ignored: 0 };
    for (const r of reports) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [reports]);

  // Per crisis-type breakdown.
  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reports) map.set(r.crisisType, (map.get(r.crisisType) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [reports]);

  return (
    <div className="cl-fade-in flex h-screen flex-col overflow-hidden bg-background">
      {/* Flag rule */}
      <div className="flex h-1 shrink-0" aria-hidden>
        <div className="flex-1 bg-black" />
        <div className="flex-1 bg-gold-fill" />
      </div>

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/?dashboard"
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </a>

        <span className="h-5 w-px bg-border" aria-hidden />

        <div className="flex items-center gap-3">
          <BwFlag />
          <span className="font-display text-lg font-semibold tracking-[0.08em]">
            ANALYTICS
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {mode} data
          </span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      {/* Scrollable content */}
      <div className="cl-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">

          {/* ---- 24h Timeline ---- */}
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="mb-1 flex items-center gap-2.5">
              <BarChart3 className="h-4 w-4 text-gold" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                Signal Volume
              </h2>
            </div>
            <div className="mt-4">
              <ReportTimeline reports={reports} />
            </div>
          </section>

          {/* ---- Status breakdown cards ---- */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Triage Breakdown
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(["relevant", "review", "ignored"] as const).map((status) => {
                const meta = STATUS_META[status];
                const count = statusCounts[status] ?? 0;
                const pct =
                  reports.length > 0
                    ? Math.round((count / reports.length) * 100)
                    : 0;
                return (
                  <div
                    key={status}
                    className="rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${meta.dot}`}
                        aria-hidden
                      />
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {meta.badge}
                      </span>
                    </div>
                    <p className="mt-3 font-display text-4xl font-semibold tabular-nums text-foreground">
                      {count}
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: meta.color,
                        }}
                      />
                    </div>
                    <p className="mt-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                      {pct}% of total
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Crisis type table ---- */}
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Reports by Crisis Type
            </h2>
            {typeCounts.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No reports in the current window.
              </p>
            ) : (
              <div className="space-y-3">
                {typeCounts.map(([type, count]) => {
                  const pct = Math.round((count / reports.length) * 100);
                  return (
                    <div key={type} className="flex items-center gap-4">
                      <span className="w-36 shrink-0 truncate text-xs font-medium text-foreground">
                        {type}
                      </span>
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gold-fill/80 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
