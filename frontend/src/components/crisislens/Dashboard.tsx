"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Activity,
  BarChart3,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Rss,
  RotateCcw,
  Search,
} from "lucide-react";

import {
  MOCK_REPORTS,
  type CrisisReport,
  type RiskLevel,
} from "@/lib/mockReports";
import { API_BASE } from "@/lib/types";
import { confidenceColor } from "@/lib/confidence";
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
import type { StreamPost } from "@/lib/types";
import type { MapFocus } from "./CrisisMap";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";
import DwdStatusTile from "./DwdStatusTile";
import PegelStatusTile from "./PegelStatusTile";
import MobiDataStatusTile from "./MobiDataStatusTile";
import DetailPanel from "./DetailPanel";
import ToastStack, { type DashboardToast } from "./ToastStack";
import LageberichtPrint from "./LageberichtPrint";
import TagFilter from "./TagFilter";
import FilterToolbar from "./FilterToolbar";
import CityFocusPicker from "./CityFocusPicker";
import CommandBanner from "./CommandBanner";
import CommandConsole from "./CommandConsole";
import ReportTimeline from "./ReportTimeline";
import MeasurePalette from "./MeasurePalette";
import ScopePicker from "./ScopePicker";

// Leaflet touches `window` — load the map strictly client-side.
const CrisisMap = dynamic(() => import("./CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
      Loading map…
    </div>
  ),
});

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

function VerdictChip({ verdict }: { verdict: StreamPost["verdict"] }) {
  if (verdict === "verified") {
    return (
      <span className="shrink-0 rounded border border-emerald-600/30 bg-emerald-500/10 px-1 py-px text-[8px] font-bold tracking-wider text-emerald-700 dark:text-emerald-300">
        VERIFIED
      </span>
    );
  }
  if (verdict === "debunked") {
    return (
      <span className="shrink-0 rounded border border-red-600/30 bg-red-500/10 px-1 py-px text-[8px] font-bold tracking-wider text-red-700 dark:text-red-300">
        DEBUNKED
      </span>
    );
  }
  return (
    <span className="shrink-0 animate-pulse rounded border border-border bg-muted px-1 py-px text-[8px] font-bold tracking-wider text-muted-foreground">
      ANALYZING
    </span>
  );
}

interface DashboardProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

/** A jurisdiction the map is centred on; its name scopes the news feed. */
interface RegionFocus {
  name: string;
  center: [number, number];
}

/** Where the live backend data is coming from (drives the header badge). */
type DataMode = "live" | "mock" | "offline";

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
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDismissed, setSearchDismissed] = useState(false);
  const [manualFocus, setManualFocus] = useState<MapFocus | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const latestRequestQuery = useRef<string>("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mapRegionRef = useRef<HTMLElement | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Live backend data (FastAPI :8000) — polls every 5 s.
  const {
    incidents,
    debunked,
    health,
    scopes,
    scopeGroups,
    activeScope,
    scopePending,
    scopeError,
    streamPosts,
    online,
    refresh,
    changeScope,
  } = useDashboard();
  const streaming = health?.feeds?.streaming;
  // Flash only posts that are NEW since the previous render cycle.
  const seenPostIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const post of streamPosts ?? []) seenPostIds.current.add(post.id);
  }, [streamPosts]);

  const mode: DataMode = !online
    ? "offline"
    : health?.data_mode === "live"
      ? "live"
      : "mock";
  const modeMeta = MODE_META[mode];

  // Whenever the backend is reachable, show its real pipeline output (dispatch/
  // SOP/classified state lives on the backend) merged with the bundled curated
  // set so cities outside the main demo scenario (e.g. Heilbronn) still show
  // data. Offline falls back to mocks only (offline judging!).
  const allReports: CrisisReport[] = useMemo(() => {
    const backendReports = (incidents?.length ?? 0) + (debunked?.length ?? 0);
    let adapted = online && backendReports > 0
      ? adaptAll(incidents ?? [], debunked ?? [])
      : [];

    // EXCLUSION: Konstanz is a live-only demo city. We never show mock data for it.
    // Backend mock data IDs start with "INC-" or "RPT-". Live IDs start with "INC-LIVE-" or "RPT-LIVE-".
    adapted = adapted.filter(r => {
      if (r.city === "Konstanz") {
        return r.id.includes("-LIVE-");
      }
      return true;
    });

    // Combine adapted backend reports with mock reports, avoiding ID collisions.
    const adaptedIds = new Set(adapted.map(r => r.id));
    const uniqueMocks = MOCK_REPORTS.filter(r => !adaptedIds.has(r.id) && r.city !== "Konstanz");
    
    return [...adapted, ...uniqueMocks];
  }, [online, incidents, debunked]);

  // ------------------------------------------------ dispatch + toasts
  const [toasts, setToasts] = useState<DashboardToast[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback(
    (kind: DashboardToast["kind"], title: string, detail?: string): void => {
      const id = ++toastSeq.current;
      setToasts((prev) => [...prev.slice(-2), { id, kind, title, detail }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    },
    [],
  );

  const dismissToast = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ------------------------------------------------ PDF export (print)
  // A print request carries the optional focus incident; the nonce re-triggers
  // the effect even when the same target is exported twice in a row. window.print
  // runs from an effect so the print document is committed to the DOM first.
  const [printRequest, setPrintRequest] = useState<{
    focus: CrisisReport | null;
    nonce: number;
  } | null>(null);

  const requestPrint = useCallback((focus: CrisisReport | null): void => {
    setPrintRequest({ focus, nonce: Date.now() });
  }, []);

  useEffect(() => {
    if (!printRequest) return;
    const id = window.setTimeout(() => window.print(), 0);
    return () => window.clearTimeout(id);
  }, [printRequest]);

  // Reset to the full-sector document once the dialog closes, so a later
  // native Ctrl/Cmd+P prints the Lagebericht rather than the last incident.
  useEffect(() => {
    const reset = (): void => setPrintRequest(null);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  const dispatchIncident = useCallback(
    async (report: CrisisReport): Promise<boolean> => {
      try {
        const res = await fetch(
          `${API_BASE}/api/incidents/${encodeURIComponent(report.id)}/dispatch`,
          { method: "POST" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pushToast(
          "success",
          "Dispatched to Leitstelle",
          `${report.crisisType} · ${report.id} handed to the control centre; SOP checklist confirmed.`,
        );
        void refresh();
        return true;
      } catch {
        pushToast(
          "error",
          "Dispatch failed",
          "Backend unreachable — the incident was NOT handed off.",
        );
        return false;
      }
    },
    [pushToast, refresh],
  );

  // Map markers honour the header filters (event type + confidence) but NOT
  // the selected region — the whole Baden-Württemberg picture stays visible.
  // We filter to ONLY show incident clusters (not individual signals) on the map.
  const reports = useMemo(
    () => {
      let filtered = allReports.filter(r => 
        r.id.startsWith("INC-") || // live incidents
        r.id.startsWith("RPT-") || // mock reports or direct injections
        r.status === "ignored"  || // debunked reports
        /^[A-Z]{2}-/.test(r.id)    // city-prefixed mock reports (e.g. HN-0275)
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
      if (deferredSearchQuery.trim()) {
        const q = deferredSearchQuery.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            r.city.toLowerCase().includes(q) ||
            r.crisisType.toLowerCase().includes(q) ||
            r.signalSnippet.toLowerCase().includes(q) ||
            r.signalSource.toLowerCase().includes(q),
        );
      }
      return filtered;
    },
    [allReports, activeTag, minConfidence, deferredSearchQuery],
  );

  // All reports in the selected jurisdiction, before the header filters. The
  // chips are built from this so every tag shown has at least one incident in
  // the current region — clicking a tag never yields an empty feed.
  const regionBase = useMemo(
    () =>
      region ? allReports.filter((r) => r.city === region.name) : allReports,
    [allReports, region],
  );

  const exitSearch = useCallback((): void => {
    setSearchDismissed(true);
    setSearchFocused(false);
    setSearchDraft("");
    setSearchQuery("");
    setManualFocus(null);
    searchInputRef.current?.blur();
    const mapContainer = mapRegionRef.current?.querySelector<HTMLElement>(".leaflet-container");
    if (mapContainer) {
      mapContainer.tabIndex = -1;
      mapContainer.focus();
      return;
    }
    mapRegionRef.current?.focus();
  }, []);

  const handleSearchKeyDown = useCallback(
    async (e: ReactKeyboardEvent<HTMLInputElement>): Promise<void> => {
      if (e.key === "Escape") {
        e.preventDefault();
        exitSearch();
        return;
      }
      if (e.key === "Enter" && searchDraft.trim().length >= 2) {
        const queryToFetch = searchDraft.trim();
        setSearchQuery(queryToFetch);
        latestRequestQuery.current = queryToFetch;
        setHasSearched(true);
        try {
          const res = await fetch(
            `${API_BASE}/api/geocode?q=${encodeURIComponent(queryToFetch)}`,
          );
          const data = await res.json();
          if (latestRequestQuery.current === queryToFetch && data.lat && data.lon) {
            setManualFocus({
              center: [data.lat, data.lon],
              zoom: 14,
            });
          }
        } catch (err) {
          console.error("Search geocoding failed", err);
        }
      }
    },
    [exitSearch, searchDraft],
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

  const cityFocus = useMemo<MapFocus | null>(() => {
    // 1. Manual map jump (from search)
    if (manualFocus) return manualFocus;

    // 2. Manual city focus (Command Mode)
    if (focusCity && scopedReports.length > 0) {
      const lat =
        scopedReports.reduce((sum, r) => sum + r.coordinates[0], 0) /
        scopedReports.length;
      const lon =
        scopedReports.reduce((sum, r) => sum + r.coordinates[1], 0) /
        scopedReports.length;
      return { center: [lat, lon], zoom: 12 };
    }

    // 3. Search results zoom
    // If the user has typed something that filters the list, fly to the center of results.
    const isSearching = deferredSearchQuery.trim().length >= 2;
    if (isSearching && reports.length > 0) {
      const lat =
        reports.reduce((sum, r) => sum + r.coordinates[0], 0) / reports.length;
      const lon =
        reports.reduce((sum, r) => sum + r.coordinates[1], 0) / reports.length;

      // If results are few or all in one city, zoom deep. Otherwise, overview.
      const uniqueCities = new Set(reports.map((r) => r.city));
      const zoom = (reports.length <= 3 || uniqueCities.size === 1) ? 14 : 10;

      return { center: [lat, lon], zoom };
    }

    // 4. Default: the operator's home jurisdiction (e.g. Mannheim).
    if (region) return { center: region.center, zoom: 14 };

    return null;
  }, [focusCity, scopedReports, reports, deferredSearchQuery, manualFocus, region]);

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

  const handleScopeSelect = useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(null);
      await changeScope(id);
    },
    [changeScope],
  );

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
    <>
    <div className="cl-app-shell cl-fade-in flex h-screen flex-col overflow-hidden bg-background">
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
          {activeScope?.group ?? "Region"}
        </span>

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

          <ScopePicker
            scopes={scopes}
            groups={scopeGroups}
            activeScope={activeScope}
            pending={scopePending}
            error={scopeError}
            onSelect={handleScopeSelect}
          />

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

          {mode === "live" && streaming?.enabled && (
            <span
              className="hidden items-center gap-2 rounded-full border border-gold/40 bg-gold-fill/10 px-3 py-1 xl:flex"
              title="Real-time social-media streams (Mastodon WebSocket · Bluesky Jetstream)"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-fill opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-fill" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
                Streaming · {streaming.posts_per_min}/min
              </span>
            </span>
          )}

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
            onClick={() => requestPrint(null)}
            title="Export the current sector picture as a printable Lagebericht (PDF)"
            className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted md:flex"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Export Lagebericht (PDF)</span>
          </button>

          <a
            href="/analytics"
            className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
            title="Signal analytics"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </a>

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
            {/* Real-time incoming-posts ticker (streaming mode only) */}
            {mode === "live" && streaming?.enabled && (
              <div className="shrink-0 border-b border-border">
                <div className="flex items-center gap-2.5 px-5 py-3">
                  <Rss className="h-4 w-4 text-gold" />
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                    Incoming Posts
                  </h2>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {streaming.posts_per_min}/min
                  </span>
                </div>
                <ul className="cl-scroll max-h-52 space-y-1.5 overflow-y-auto px-3 pb-3">
                  {(streamPosts?.length ?? 0) === 0 ? (
                    <li className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      Listening to live streams —{" "}
                      {streaming.connections
                        .map((c) => `${c.name.split(":")[0]}: ${c.state}`)
                        .join(" · ") || "starting…"}
                    </li>
                  ) : (
                    streamPosts?.map((post) => {
                      const isNew = !seenPostIds.current.has(post.id);
                      return (
                        <li
                          key={post.id}
                          className={`rounded-md border border-border bg-card px-2.5 py-2 ${isNew ? "cl-rise" : ""}`}
                        >
                          <span className="flex items-center gap-2">
                            <VerdictChip verdict={post.verdict} />
                            <span className="truncate text-[11px] font-semibold text-foreground">
                              {post.author}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                              {timeAgo(post.timestamp)}
                            </span>
                          </span>
                          <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                            {post.text}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            )}
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

            {feed.length > 0 && (
              <div className="mb-3 rounded-lg border border-border bg-card p-3.5 shadow-sm">
                <ReportTimeline reports={feed} decayShape={region?.name === "Mannheim" && minConfidence <= 1} />
              </div>
            )}
            {feed.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                No current news{region ? ` for ${region.name}` : ""}.
              </p>
            ) : (
              <ul className="space-y-2">
                {feed.map((report) => {
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
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: confidenceColor(report.confidence) }}
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
        <main
          ref={mapRegionRef}
          tabIndex={-1}
          className="relative min-w-0 flex-1 focus:outline-none"
          aria-label="Map region"
        >
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
            scope={activeScope}
          />

          {/* Measure palette — the editable tactical layer (Command Mode). */}
          {focusCity && !selected && (
            <MeasurePalette armed={armedTool} onArm={setArmedTool} />
          )}

          {/* Map tint overlay — visible only before the user picks a location */}
          <div
            className={`pointer-events-none absolute inset-0 z-[999] bg-black transition-opacity duration-500 ${
              searchDismissed || manualFocus || searchDraft || searchQuery || selected
                ? "opacity-0"
                : "opacity-50"
            }`}
            aria-hidden
          />

          {/* Floating Search Bar — centred until the user picks a location */}
          <div
            className={`pointer-events-none absolute left-1/2 z-[1000] -translate-x-1/2 px-4 transition-all duration-500 ease-in-out ${
              searchDismissed || manualFocus || searchDraft || searchQuery || selected
                ? "bottom-6 top-auto -translate-y-0"
                : "top-1/2 -translate-y-1/2"
            }`}
          >
            <div className="pointer-events-auto flex flex-col items-center gap-4">
              {!searchDismissed && !manualFocus && !searchDraft && !searchQuery && !selected && (
                <div className="mb-2 text-center">
                  <p className="font-display text-2xl font-bold tracking-wide text-white drop-shadow-lg">
                    Where do you want to monitor?
                  </p>
                  <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-white/60">
                    Enter a city or region and press Enter
                  </p>
                </div>
              )}
              <div
                className={`flex items-center gap-3 rounded-2xl border-2 bg-white px-5 shadow-[0_8px_40px_rgba(0,0,0,0.5)] transition-all duration-500 dark:bg-zinc-900 ${
                  manualFocus || searchDraft || searchQuery || selected
                    ? "border-border py-2"
                    : "border-gold/70 py-4 ring-4 ring-gold/20"
                }`}
              >
                <Search
                  className={`shrink-0 transition-all duration-500 ${
                    manualFocus || searchDraft || searchQuery
                      ? "h-4 w-4 text-gold"
                      : "h-5 w-5 text-gold"
                  }`}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="e.g. Konstanz, Stuttgart, Freiburg…"
                  value={searchDraft}
                  autoFocus={!manualFocus && !searchDismissed}
                  onFocus={() => {
                    setSearchFocused(true);
                    setSearchDismissed(false);
                  }}
                  onBlur={() => setSearchFocused(false)}
                  onChange={(e) => {
                    setSearchDismissed(false);
                    setSearchDraft(e.target.value);
                    if (!e.target.value) {
                      setSearchQuery("");
                      setManualFocus(null);
                    }
                  }}
                  onKeyDown={handleSearchKeyDown}
                  className={`bg-transparent font-mono text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-white dark:placeholder-zinc-500 ${
                    manualFocus || searchDraft || searchQuery
                      ? "w-72 text-sm lg:w-96"
                      : "w-80 text-base lg:w-[480px]"
                  }`}
                />
                {searchFocused && (
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
                    Esc to exit
                  </span>
                )}
                {(searchDraft || searchQuery) && (
                  <button
                    onClick={exitSearch}
                    title="Clear search"
                    className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
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
        <DetailPanel
          report={selected}
          onClose={() => setSelectedId(null)}
          onDispatch={dispatchIncident}
          onExportPdf={requestPrint}
        />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>

    {/* Print-only report — hidden on screen, revealed by @media print. Full
        sector Lagebericht by default, or a single-incident dossier on focus. */}
    <LageberichtPrint reports={allReports} focus={printRequest?.focus ?? null} />
    </>
  );
}
