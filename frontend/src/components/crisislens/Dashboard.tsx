"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, PanelLeftClose, PanelLeftOpen, RotateCcw } from "lucide-react";

import {
  MOCK_REPORTS,
  STATUS_META,
  type CrisisReport,
  type RiskLevel,
} from "@/lib/mockReports";
import { adaptAll } from "@/lib/liveAdapter";
import { firstSignalAt } from "@/lib/mediaResponse";
import {
  MEASURE_KINDS,
  newMeasureId,
  useCityMeasures,
  type MeasureKind,
  type PlacedMeasure,
} from "@/lib/measures";
import { useDashboard } from "@/hooks/useDashboard";
import { timeAgo } from "@/lib/format";
import type { MapFocus } from "./CrisisMap";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";
import DetailPanel from "./DetailPanel";
import TagFilter from "./TagFilter";
import CityFocusPicker from "./CityFocusPicker";
import CommandBanner from "./CommandBanner";
import CommandConsole from "./CommandConsole";
import MeasurePalette from "./MeasurePalette";

// Leaflet touches `window` — load the map strictly client-side.
const CrisisMap = dynamic(() => import("./CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
      Loading Baden-Württemberg sector map…
    </div>
  ),
});

type DataMode = "live" | "mock" | "offline";

const MODE_META: Record<
  DataMode,
  { label: string; chip: string; dot: string; ping: boolean }
> = {
  live: {
    label: "Live Data",
    chip: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    ping: true,
  },
  mock: {
    label: "Mock Data",
    chip: "border-gold/40 bg-gold-fill/10 text-gold",
    dot: "bg-gold-fill",
    ping: false,
  },
  offline: {
    label: "Offline Demo",
    chip: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    ping: false,
  },
};

interface DashboardProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

/** Main command-center view: map, stats, signal feed and report dossier. */
export default function Dashboard({ theme, onToggleTheme }: DashboardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCity, setFocusCity] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<Date | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(true);

  // Live backend data (FastAPI :8000) — polls every 5 s.
  const { incidents, debunked, health, online } = useDashboard();

  const mode: DataMode = !online
    ? "offline"
    : health?.data_mode === "live"
      ? "live"
      : "mock";

  // Real pipeline output in live mode; the curated mock set otherwise — the
  // dashboard always has something meaningful to show (offline judging!).
  const allReports: CrisisReport[] = useMemo(
    () =>
      mode === "live"
        ? adaptAll(incidents ?? [], debunked ?? [])
        : MOCK_REPORTS,
    [mode, incidents, debunked],
  );

  const reports = useMemo(
    () =>
      activeTag
        ? allReports.filter((r) => r.crisisType === activeTag)
        : allReports,
    [allReports, activeTag],
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allReports.forEach((r) => {
      counts[r.crisisType] = (counts[r.crisisType] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [allReports]);

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  // Command Mode scopes the entire dashboard — stats, feed, map — to one city.
  const scopedReports = useMemo(
    () =>
      focusCity ? reports.filter((r) => r.city === focusCity) : reports,
    [reports, focusCity],
  );

  // Leave Command Mode automatically if the city drops off the board
  // (live feeds can age incidents out between polls).
  useEffect(() => {
    if (focusCity && !reports.some((r) => r.city === focusCity)) {
      setFocusCity(null);
    }
  }, [focusCity, reports]);

  const cityFocus = useMemo<MapFocus | null>(() => {
    if (!focusCity || scopedReports.length === 0) return null;
    const lat =
      scopedReports.reduce((sum, r) => sum + r.coordinates[0], 0) /
      scopedReports.length;
    const lon =
      scopedReports.reduce((sum, r) => sum + r.coordinates[1], 0) /
      scopedReports.length;
    return { center: [lat, lon], zoom: 12 };
  }, [focusCity, scopedReports]);

  const firstSignal = useMemo(
    () => (focusCity ? firstSignalAt(scopedReports) : null),
    [focusCity, scopedReports],
  );

  const highestRisk = useMemo<RiskLevel | null>(() => {
    if (scopedReports.length === 0) return null;
    if (scopedReports.some((r) => r.riskLevel === "High")) return "High";
    if (scopedReports.some((r) => r.riskLevel === "Moderate")) return "Moderate";
    return "Low";
  }, [scopedReports]);

  // ----------------------------------------------------- measures layer
  const [measures, updateMeasures] = useCityMeasures(focusCity);
  const [armedTool, setArmedTool] = useState<MeasureKind | null>(null);
  const [selectedMeasureId, setSelectedMeasureId] = useState<string | null>(null);
  const [hoveredMeasureId, setHoveredMeasureId] = useState<string | null>(null);

  const placeMeasure = useCallback(
    (position: [number, number]): void => {
      // Read the armed tool via the setter so the callback stays stable.
      setArmedTool((kind) => {
        if (!kind) return null;
        const meta = MEASURE_KINDS[kind];
        const id = newMeasureId();
        updateMeasures((prev) => [
          ...prev,
          {
            id,
            kind,
            label: meta.labelDe,
            note: "",
            status: "planned",
            position,
            ...(kind === "zone" ? { radiusM: meta.defaultRadiusM ?? 500 } : {}),
            createdAt: new Date().toISOString(),
          },
        ]);
        setSelectedId(null);
        setSelectedMeasureId(id);
        return null; // single-drop semantics: disarm after placing
      });
    },
    [updateMeasures],
  );

  const updateMeasure = useCallback(
    (id: string, patch: Partial<PlacedMeasure>): void => {
      updateMeasures((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      );
    },
    [updateMeasures],
  );

  const removeMeasure = useCallback(
    (id: string): void => {
      updateMeasures((prev) => prev.filter((m) => m.id !== id));
      setSelectedMeasureId((current) => (current === id ? null : current));
    },
    [updateMeasures],
  );

  const clearMeasures = useCallback((): void => {
    updateMeasures(() => []);
    setSelectedMeasureId(null);
  }, [updateMeasures]);

  // The dossier and the measure editor are mutually exclusive selections.
  const selectMeasure = useCallback((id: string | null): void => {
    if (id) setSelectedId(null);
    setSelectedMeasureId(id);
  }, []);

  const selectIncident = useCallback((id: string): void => {
    setSelectedMeasureId(null);
    setSelectedId(id);
  }, []);

  const enterCommandMode = (city: string): void => {
    setSelectedId(null);
    setSelectedMeasureId(null);
    setArmedTool(null);
    setFocusCity(city);
  };

  const exitCommandMode = (): void => {
    setSelectedId(null);
    setSelectedMeasureId(null);
    setArmedTool(null);
    setFocusCity(null);
  };

  // "Last analysis" reflects actual data refreshes from the poll loop.
  useEffect(() => {
    setLastAnalysis(new Date());
  }, [reports]);

  // Escape peels back one layer at a time: armed tool → measure selection →
  // dossier → Command Mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (armedTool) setArmedTool(null);
      else if (selectedMeasureId) setSelectedMeasureId(null);
      else if (selectedId) setSelectedId(null);
      else if (focusCity) setFocusCity(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armedTool, selectedMeasureId, selectedId, focusCity]);


  const feed = useMemo(
    () =>
      [...scopedReports].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [scopedReports],
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
          {!focusCity && (
            <CityFocusPicker reports={reports} onFocus={enterCommandMode} />
          )}

          <span
            className={`hidden items-center gap-2 rounded-full border px-3 py-1 sm:flex ${modeMeta.chip}`}
            title="Data source: live backend pipeline vs. bundled demo dataset"
          >
            <span className="relative flex h-2 w-2">
              {modeMeta.ping && (
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${modeMeta.dot}`}
                />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${modeMeta.dot}`}
              />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
              {modeMeta.label}
            </span>
          </span>

          <span
            className="hidden rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:block"
            title="LLM analyst mode (LiteLLM gateway, Qwen3-VL)"
          >
            AI {health?.ai_mode ?? "mock"}
          </span>

          <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground lg:block">
            Last analysis{" "}
            <span className="text-foreground" suppressHydrationWarning>
              {lastAnalysis ? lastAnalysis.toLocaleTimeString("de-DE") : "—"}
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

          <button
            type="button"
            onClick={() => setFeedOpen((o) => !o)}
            title={feedOpen ? "Collapse signals feed" : "Expand signals feed"}
            className="hidden rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:block"
          >
            {feedOpen
              ? <PanelLeftClose className="h-4 w-4" />
              : <PanelLeftOpen className="h-4 w-4" />
            }
          </button>

          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </header>

      {/* -------------------------------------------- command mode banner */}
      {focusCity && (
        <CommandBanner
          city={focusCity}
          firstSignal={firstSignal}
          reportCount={scopedReports.length}
          highestRisk={highestRisk}
          onExit={exitCommandMode}
        />
      )}

      {/* ----------------------------------------------------- main row */}
      <div className="flex min-h-0 flex-1">
        {/* Latest signals rail — collapses away when a node is selected or user toggles. */}
        <aside
          className="hidden shrink-0 overflow-hidden transition-[width] duration-500 ease-in-out lg:block"
          style={{ width: selected || !feedOpen ? 0 : 300 }}
          aria-hidden={Boolean(selected) || !feedOpen}
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
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                No signals in the current window yet — the pipeline is polling
                live sources. Trigger a cycle via{" "}
                <span className="font-mono">POST /api/poll</span>.
              </p>
            ) : (
              <ul className="space-y-2">
                {feed.map((report) => {
                  const meta = STATUS_META[report.status];
                  const isSelected = report.id === selectedId;
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => selectIncident(report.id)}
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
            {mode === "live"
              ? "AI-assisted plausibility on live open feeds (NINA · police RSS · Mastodon). Human review required before escalation."
              : "AI-assisted plausibility estimates on synthetic data. Human review required before escalation."}
          </p>
          </div>
        </aside>

        {/* Map column */}
        <main className="relative min-w-0 flex-1">
          <CrisisMap
            reports={scopedReports}
            selectedId={selectedId}
            onSelect={selectIncident}
            theme={theme}
            focus={cityFocus}
            measures={focusCity ? measures : []}
            armedTool={armedTool}
            selectedMeasureId={selectedMeasureId}
            hoveredMeasureId={hoveredMeasureId}
            onPlaceMeasure={placeMeasure}
            onSelectMeasure={selectMeasure}
            onHoverMeasure={setHoveredMeasureId}
            onMoveMeasure={(id, position) => updateMeasure(id, { position })}
            onResizeZone={(id, radiusM) => updateMeasure(id, { radiusM })}
          />

          {/* Tag filter */}
          <TagFilter
            tags={tagCounts}
            active={activeTag}
            onChange={setActiveTag}
          />

          {/* Measure palette — the editable tactical layer (Command Mode). */}
          {focusCity && !selected && (
            <MeasurePalette armed={armedTool} onArm={setArmedTool} />
          )}

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

        {/* Command console — LISTEN + RESPOND for the focused city. It
            collapses like the signals rail when the dossier takes over. */}
        {focusCity && (
          <aside
            className="hidden shrink-0 overflow-hidden transition-[width] duration-500 ease-in-out md:block"
            style={{ width: selected ? 0 : 420 }}
            aria-hidden={Boolean(selected)}
          >
            <div className="h-full w-[420px] border-l border-border">
              <CommandConsole
                city={focusCity}
                reports={scopedReports}
                measures={measures}
                origin={cityFocus?.center ?? null}
                selectedMeasureId={selectedMeasureId}
                hoveredMeasureId={hoveredMeasureId}
                onSelectMeasure={selectMeasure}
                onHoverMeasure={setHoveredMeasureId}
                onUpdateMeasure={updateMeasure}
                onRemoveMeasure={removeMeasure}
                onClearMeasures={clearMeasures}
              />
            </div>
          </aside>
        )}

        {/* Report dossier */}
        <DetailPanel report={selected} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  );
}
