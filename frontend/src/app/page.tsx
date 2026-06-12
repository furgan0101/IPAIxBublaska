"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radar, WifiOff } from "lucide-react";

import DemoControls from "@/components/DemoControls";
import FilterChips, { type TypeCount } from "@/components/FilterChips";
import KpiStrip from "@/components/KpiStrip";
import Sidebar, { type Tab } from "@/components/Sidebar";
import Toasts, { type Toast } from "@/components/Toasts";
import type { MapFocus } from "@/components/Map";
import { useDashboard } from "@/hooks/useDashboard";
import { formatUtcTime } from "@/lib/format";
import type { DebunkedReport, HealthInfo, SubmissionResult } from "@/lib/types";

// Leaflet touches `window` — load the map strictly client-side.
const IncidentMap = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm text-slate-500">
      Initialising tactical map…
    </div>
  ),
});

const TOAST_LIFETIME_MS = 6_500;
const FLASH_LIFETIME_MS = 6_500;

function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="font-mono text-xs text-slate-400" suppressHydrationWarning>
      {now ? formatUtcTime(now) : "--:--:--"} UTC
    </span>
  );
}

const AI_BADGE: Record<HealthInfo["ai_mode"], { label: string; style: string }> = {
  mock: { label: "AI: MOCK", style: "border-slate-600 text-slate-400" },
  "live-ready": { label: "AI: LIVE-READY", style: "border-cyan-500/50 text-cyan-300" },
  live: { label: "AI: LIVE", style: "border-emerald-500/50 text-emerald-300" },
};

export default function Home() {
  const { incidents, debunked, health, online, pulseIds, refresh } =
    useDashboard();

  const [tab, setTab] = useState<Tab>("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState<DebunkedReport | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const toastSeq = useRef(0);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      TOAST_LIFETIME_MS,
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Filter drives map + lists together (KPIs stay global).
  const filteredIncidents = useMemo(
    () =>
      incidents === null
        ? null
        : incidents.filter((i) => filterType === null || i.event_type === filterType),
    [incidents, filterType],
  );
  const filteredDebunked = useMemo(
    () =>
      debunked === null
        ? null
        : debunked.filter((d) => filterType === null || d.event_type === filterType),
    [debunked, filterType],
  );

  const typeCounts = useMemo<TypeCount[]>(() => {
    const counts = new Map<string, number>();
    for (const incident of incidents ?? []) {
      counts.set(incident.event_type, (counts.get(incident.event_type) ?? 0) + 1);
    }
    return [...counts.entries()].map(([type, count]) => ({ type, count }));
  }, [incidents]);

  // Selection survives filtering: look it up in the unfiltered list.
  const selectedIncident = useMemo(
    () => incidents?.find((i) => i.id === selectedId) ?? null,
    [incidents, selectedId],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId((prev) => {
        const next = prev === id ? null : id;
        if (next) {
          const incident = incidents?.find((i) => i.id === id);
          if (incident) {
            setTab("live");
            setFocus({
              lat: incident.lat,
              lon: incident.lon,
              key: `select-${id}-${++toastSeq.current}`,
            });
          }
        }
        return next;
      });
    },
    [incidents],
  );

  const clearSelection = useCallback(() => setSelectedId(null), []);

  // ESC closes the incident dossier.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Demo injection verdict → toast + fly-to + (for hoaxes) amber flash marker.
  const handleDemoResult = useCallback(
    async (result: SubmissionResult) => {
      const data = await refresh();
      if (result.verdict === "verified") {
        pushToast({
          kind: "verified",
          title: "✓ Report verified",
          detail: result.message,
        });
        const incident = data?.incidents.find((i) => i.id === result.incident_id);
        if (incident) {
          setTab("live");
          setSelectedId(incident.id);
          setFocus({
            lat: incident.lat,
            lon: incident.lon,
            key: `inject-${++toastSeq.current}`,
          });
        }
      } else {
        pushToast({
          kind: "debunked",
          title: "⚠ Disinformation caught",
          detail: result.reason_flagged ?? result.message,
        });
        const fresh = data?.debunked[0] ?? null;
        if (fresh) {
          setTab("debunked");
          setSelectedId(null);
          setFlash(fresh);
          setFocus({
            lat: fresh.lat,
            lon: fresh.lon,
            key: `flash-${++toastSeq.current}`,
          });
          window.setTimeout(
            () => setFlash((cur) => (cur?.id === fresh.id ? null : cur)),
            FLASH_LIFETIME_MS,
          );
        }
      }
    },
    [pushToast, refresh],
  );

  const handleReset = useCallback(async () => {
    await refresh();
    setSelectedId(null);
    setHoverId(null);
    setFilterType(null);
    setFlash(null);
    setTab("live");
    setFocus({ lat: 47.6603, lon: 9.1758, zoom: 14, key: `reset-${++toastSeq.current}` });
    pushToast({ kind: "info", title: "Scenario reset to baseline" });
  }, [pushToast, refresh]);

  const aiBadge = AI_BADGE[health?.ai_mode ?? "mock"];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-5 py-3">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-1.5">
          <Radar className="h-5 w-5 text-red-500" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold tracking-widest text-slate-100">
            VOST<span className="text-red-500">BW</span> · OSINT SITUATIONAL
            AWARENESS
          </h1>
          <p className="truncate text-[11px] uppercase tracking-wider text-slate-500">
            Sector Konstanz · 47.6603 N, 9.1758 E · verification radius 1.0 km
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <UtcClock />
          <span
            className={`rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest ${aiBadge.style}`}
          >
            {aiBadge.label}
          </span>
          <div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="text-[11px] font-semibold tracking-widest text-red-400">
              LIVE
            </span>
          </div>
        </div>
      </header>

      {/* ── SITREP strip ───────────────────────────────────────────── */}
      <KpiStrip incidents={incidents} debunked={debunked} />

      {/* ── Map + sidebar ──────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <IncidentMap
            incidents={filteredIncidents ?? []}
            selectedId={selectedId}
            hoverId={hoverId}
            pulseIds={pulseIds}
            flash={flash}
            focus={focus}
            onSelect={handleSelect}
            onHover={setHoverId}
          />

          <FilterChips
            types={typeCounts}
            active={filterType}
            onChange={setFilterType}
          />

          <DemoControls onResult={handleDemoResult} onReset={handleReset} />
          <Toasts toasts={toasts} onDismiss={dismissToast} />

          {!online && (
            <div className="panel-glass absolute left-1/2 top-4 z-[1050] flex -translate-x-1/2 items-center gap-2 rounded-full border-amber-500/40 px-4 py-2 text-xs font-semibold tracking-wide text-amber-300">
              <WifiOff className="h-4 w-4" aria-hidden />
              API OFFLINE — RECONNECTING…
            </div>
          )}
        </main>

        <Sidebar
          incidents={filteredIncidents}
          debunked={filteredDebunked}
          tab={tab}
          onTabChange={setTab}
          selectedIncident={selectedIncident}
          hoverId={hoverId}
          onSelect={handleSelect}
          onClearSelection={clearSelection}
          onHover={setHoverId}
        />
      </div>
    </div>
  );
}
