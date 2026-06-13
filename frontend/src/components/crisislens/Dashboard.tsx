"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, PanelLeftClose, PanelLeftOpen, RotateCcw } from "lucide-react";

import {
  MOCK_REPORTS,
  type CrisisReport,
  type RiskLevel,
} from "@/lib/mockReports";
import { trustMeta } from "@/lib/trust";
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
import { safeNewDate, timeAgo } from "@/lib/format";
import { API_BASE } from "@/lib/types";
import type { MapFocus } from "./CrisisMap";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";
import DwdStatusTile from "./DwdStatusTile";
import PegelStatusTile from "./PegelStatusTile";
import MobiDataStatusTile from "./MobiDataStatusTile";
import DetailPanel from "./DetailPanel";
import TagFilter from "./TagFilter";
import FilterToolbar from "./FilterToolbar";
import CityFocusPicker from "./CityFocusPicker";
import CommandBanner from "./CommandBanner";
import CommandConsole from "./CommandConsole";
import ReportTimeline from "./ReportTimeline";
import MeasurePalette from "./MeasurePalette";

// Leaflet touches `window` — load the map strictly client-side.
const CrisisMap = dynamic(() => import("./CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
      Loading map…
    </div>
  ),
});

interface DashboardProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

/** A jurisdiction the map is centred on; its name scopes the news feed. */
interface RegionFocus {
  name: string;
  center: [number, number];
}

// Demo default: the dashboard boots straight into the operator's jurisdiction
// (Mannheim) with the industrial-fire scenario front and centre — no gate,
// no modal. The wider Baden-Württemberg map stays fully populated underneath.
const DEFAULT_REGION: RegionFocus = {
  name: "Mannheim",
  center: [49.4875, 8.466],
};

/** Main command-center view: map, stats, signal feed and report dossier. */
export default function Dashboard({ theme, onToggleTheme }: DashboardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCity, setFocusCity] = useState<string | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<Date | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState(1);
  const [region, setRegion] = useState<RegionFocus | null>(DEFAULT_REGION);
  const [feedOpen, setFeedOpen] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);

  // Live backend data (FastAPI :8000) — polls every 5 s.
  const { incidents, debunked, online, refresh } = useDashboard();

  // Whenever the backend is reachable, show its real pipeline output —
  // mock_data.json verified, clustered and debunked through the same code
  // path as live feeds. Only fall back to the bundled curated set when the
  // API is unreachable, so the dashboard still has something to show
  // (offline judging!).
  const allReports: CrisisReport[] = useMemo(() => {
    const backendReports = (incidents?.length ?? 0) + (debunked?.length ?? 0);
    const adapted = online && backendReports > 0
      ? adaptAll(incidents ?? [], debunked ?? [])
      : MOCK_REPORTS;

    // Only Mannheim shows mock data; other search queries rely on LIVE data
    return adapted.filter(
      (r) => r.city === "Mannheim" || r.id.includes("LIVE-")
    );
  }, [online, incidents, debunked]);

  // Map markers honour the header filters (event type + confidence) but NOT
  // the selected region — the whole Baden-Württemberg picture stays visible.
  // We filter to ONLY show incident clusters (not individual signals) on the map.
  const reports = useMemo(
    () => {
      let filtered = allReports.filter(r => 
        r.id.startsWith("INC-") || // live incidents
        r.id.startsWith("RPT-") || // mock reports or direct injections
        r.status === "ignored"     // debunked reports
      );
      if (activeTag) {
        filtered = filtered.filter((r) => r.crisisType === activeTag);
      }
      if (minConfidence > 1) {
        // Map 1-5 scale to 0-100% threshold: (val-1) * 25
        // e.g., 1.0 -> 0%, 3.0 -> 50%, 5.0 -> 100%
        const threshold = (minConfidence - 1) * 25;
        filtered = filtered.filter((r) => r.confidence >= threshold);
      }
      return filtered;
    },
    [allReports, activeTag, minConfidence],
  );

  // All reports in the selected jurisdiction, before the header filters. The
  // chips are built from this so every tag shown has at least one incident in
  // the current region — clicking a tag never yields an empty feed.
  const regionBase = useMemo(
    () =>
      region ? allReports.filter((r) => r.city === region.name) : allReports,
    [allReports, region],
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    regionBase.forEach((r) => {
      counts[r.crisisType] = (counts[r.crisisType] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [regionBase]);

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  // The map always plots the full board; the selected region only scopes the
  // feed (and the Command-Mode tooling, which keys off focusCity).
  const scopedReports = useMemo(
    () =>
      focusCity ? reports.filter((r) => r.city === focusCity) : reports,
    [reports, focusCity],
  );

  // The news feed is scoped to the selected jurisdiction (e.g. Mannheim).
  const regionReports = useMemo(
    () =>
      region ? reports.filter((r) => r.city === region.name) : reports,
    [reports, region],
  );

  // Centre the map on the selected region; a selected incident overrides this
  // inside MapController.
  const cityFocus = useMemo<MapFocus | null>(
    () => (region && hasSearched ? { center: region.center, zoom: 14 } : null),
    [region, hasSearched],
  );

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
    () => {
      let base = region 
        ? allReports.filter((r) => r.city === region.name)
        : allReports;
        
      if (activeTag) {
        base = base.filter((r) => r.crisisType === activeTag);
      }
      if (minConfidence > 1) {
        const threshold = (minConfidence - 1) * 25;
        base = base.filter((r) => r.confidence >= threshold);
      }
        
      const limit = region?.name === "Mannheim" ? 37 : 150;
      const sorted = [...base]
        .sort(
          (a, b) =>
            safeNewDate(b.timestamp).getTime() - safeNewDate(a.timestamp).getTime(),
        )
        .slice(0, limit);

      if (sorted.length > 0 && sorted.length % 2 === 0) {
        return sorted.slice(0, sorted.length - 1);
      }
      return sorted;
    },
    [allReports, region, activeTag, minConfidence],
  );

  const popularSummary = useMemo(() => {
    if (feed.length === 0) return null;

    const summaries: Array<{
      title: string;
      text: string;
      icon: string;
      type: "critical" | "warning" | "info";
      reportId?: string;
    }> = [];

    // Check if we are in Mannheim (the main demo scenario)
    if (region?.name === "Mannheim") {
      // 1. Fire connected to water level, evacuation, and hazmat release
      const fireReport = feed.find(r => r.id === "INC-MH-FIRE");
      summaries.push({
        title: "Industrial Fire Chain",
        text: "Major industrial fire in Rheinau sector connected directly to local evacuation orders, Neckar water supply alerts, and toxic hazmat plume releases.",
        icon: "🔥",
        type: "critical",
        reportId: fireReport?.id || "INC-MH-FIRE",
      });

      // 2. Motorway accident/closure
      const transportReport = feed.find(r => r.id === "INC-MH-A6" || r.crisisType.toLowerCase().includes("transport") || r.title.toLowerCase().includes("transport") || r.id === "INC-MH-TRANS");
      summaries.push({
        title: "Motorway Closure & Traffic",
        text: "The A6 motorway is closed near Sandhofen due to heavy smoke drift, causing major transport blockages and tailbacks.",
        icon: "🚗",
        type: "warning",
        reportId: transportReport?.id || "INC-MH-A6",
      });


    } else {
      // Dynamic fallback for other cities
      // Sort feed to find top critical incidents
      const sortedBySeverity = [...feed].sort((a, b) => {
        const aRiskVal = a.riskLevel === "High" ? 3 : a.riskLevel === "Moderate" ? 2 : 1;
        const bRiskVal = b.riskLevel === "High" ? 3 : b.riskLevel === "Moderate" ? 2 : 1;
        if (bRiskVal !== aRiskVal) return bRiskVal - aRiskVal;
        return b.confidence - a.confidence;
      });

      // Take the top 2 unique crisis types if possible, otherwise top 2 reports
      const selectedReports: typeof feed = [];
      const seenTypes = new Set<string>();

      for (const r of sortedBySeverity) {
        if (!seenTypes.has(r.crisisType) && selectedReports.length < 2) {
          selectedReports.push(r);
          seenTypes.add(r.crisisType);
        }
      }
      
      // Fill up to 2 if needed
      for (const r of sortedBySeverity) {
        if (selectedReports.length < 2 && !selectedReports.some(sr => sr.id === r.id)) {
          selectedReports.push(r);
        }
      }

      selectedReports.forEach((r, idx) => {
        const isCritical = r.riskLevel === "High" || r.confidence >= 80;
        summaries.push({
          title: r.title,
          text: `${r.crisisType} alert in ${r.city}. Plausibility is estimated at ${r.confidence}% (${r.riskLevel} risk).`,
          icon: idx === 0 ? "⚠️" : "📢",
          type: isCritical ? "critical" : "warning",
          reportId: r.id,
        });
      });
    }

    return {
      items: summaries.slice(0, 3), // limit to max 3 items
    };
  }, [feed, region]);

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

        <div className="ml-auto flex items-center gap-3">
          <DwdStatusTile
            locationName={region?.name ?? null}
            lat={region?.center?.[0] ?? null}
            lon={region?.center?.[1] ?? null}
          />
          <PegelStatusTile
            locationName={region?.name ?? null}
            lat={region?.center?.[0] ?? null}
            lon={region?.center?.[1] ?? null}
          />
          <MobiDataStatusTile
            locationName={region?.name ?? null}
            lat={region?.center?.[0] ?? null}
            lon={region?.center?.[1] ?? null}
          />
          
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

      <FilterToolbar
        tagCounts={tagCounts}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
        minConfidence={minConfidence}
        setMinConfidence={setMinConfidence}
        regionName={hasSearched ? (region?.name ?? null) : null}
        onSelectCity={(hit) => {
          setSelectedId(null);
          setActiveTag(null); // a tag from the previous region may not exist here
          setRegion({ name: hit.name, center: hit.center });
          setHasSearched(true);
          // Trigger the backend to run a live poll cycle to fetch latest warnings for the new region
          fetch(
            `${API_BASE}/api/poll?q=${encodeURIComponent(hit.name)}&lat=${hit.center[0]}&lon=${hit.center[1]}`,
            { method: "POST" }
          )
            .then(() => {
              // Immediately fetch updated incident list
              refresh().catch(() => {});
            })
            .catch(() => {});
        }}
        onClearRegion={() => {
          setActiveTag(null);
          setRegion(null);
          setHasSearched(false);
        }}
      />

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
            {popularSummary && (
              <div className="border-b border-border p-3 bg-muted/10 shrink-0">
                <div className="px-2 pb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Critical Summaries
                  </span>
                  <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-red-500">
                    Live Alerts
                  </span>
                </div>
                
                <div className="space-y-2 mt-2 max-h-[300px] overflow-y-auto cl-scroll pr-1">
                  {popularSummary.items.map((item, index) => {
                    const isCritical = item.type === "critical";
                    const isWarning = item.type === "warning";
                    
                    const borderClass = isCritical 
                      ? "border-red-500/30 bg-red-500/5 dark:border-red-500/25 dark:bg-red-500/5" 
                      : isWarning
                        ? "border-amber-500/30 bg-amber-500/5 dark:border-amber-500/25 dark:bg-amber-500/5"
                        : "border-border bg-card/60 hover:bg-muted/40";
                    
                    const titleColorClass = isCritical
                      ? "text-red-500"
                      : isWarning
                        ? "text-amber-500 dark:text-amber-400"
                        : "text-foreground font-semibold";

                    return (
                      <div 
                        key={index} 
                        className={`rounded-lg border p-3 shadow-sm relative overflow-hidden transition-all ${borderClass}`}
                      >
                        {/* Top indicator line */}
                        {item.type !== "info" && (
                          <div className={`absolute top-0 left-0 right-0 h-1 ${isCritical ? "bg-red-500" : "bg-amber-500"}`} />
                        )}

                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm shrink-0" aria-hidden>{item.icon}</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${titleColorClass}`}>
                            {item.title}
                          </span>
                        </div>

                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {item.text}
                        </p>

                        {item.reportId && (
                          <div className="mt-2.5">
                            <button
                              type="button"
                              onClick={() => selectIncident(item.reportId!)}
                              className="w-full rounded border border-border/80 bg-muted/45 hover:bg-muted py-1 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-foreground transition-colors cursor-pointer"
                            >
                              Investigate Alert
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
              <Activity className="h-4 w-4 text-gold" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                News Feed
              </h2>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {feed.length}
              </span>
            </div>

            <div className="cl-scroll min-h-0 flex-1 overflow-y-auto p-3">

            <div className="mb-3 rounded-lg border border-border bg-card p-3.5 shadow-sm">
              <ReportTimeline reports={feed} decayShape={region?.name === "Mannheim"} />
            </div>
            {feed.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                No current news{region ? ` for ${region.name}` : ""}.
              </p>
            ) : (
              <ul className="space-y-2">
                {feed.map((report) => {
                  const meta = trustMeta(report.confidence);
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

          </div>
        </aside>

        {/* Map column */}
        <main className="relative min-w-0 flex-1">
          {/* Feed toggle — anchored to the left edge of the map so it's always visible */}
          <button
            type="button"
            onClick={() => setFeedOpen((o) => !o)}
            title={feedOpen ? "Collapse signals feed" : "Expand signals feed"}
            className="absolute left-0 top-1/2 z-[1000] hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground lg:flex"
          >
            {feedOpen ? (
              <PanelLeftClose className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            )}
          </button>

          <CrisisMap
            reports={scopedReports}
            selectedId={selectedId}
            onSelect={selectIncident}
            theme={theme}
            focus={cityFocus}
            hasSearched={hasSearched}
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

          {/* Measure palette — the editable tactical layer (Command Mode). */}
          {focusCity && !selected && (
            <MeasurePalette armed={armedTool} onArm={setArmedTool} />
          )}
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
