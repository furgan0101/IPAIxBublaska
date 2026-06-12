"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  Flame,
  Radio,
  ShieldX,
  TriangleAlert,
  Users,
  Waves,
  WifiOff,
} from "lucide-react";

import { API_BASE, type DebunkedReport, type VerifiedIncident } from "@/lib/types";
import { confidencePercent, timeAgo, titleCase } from "@/lib/format";

const REFRESH_INTERVAL_MS = 10_000;

type Tab = "live" | "debunked";

function EventIcon({
  eventType,
  className,
}: {
  eventType: string;
  className?: string;
}) {
  if (eventType === "fire") return <Flame className={className} />;
  if (eventType === "flood") return <Waves className={className} />;
  return <TriangleAlert className={className} />;
}

export default function Sidebar() {
  const [tab, setTab] = useState<Tab>("live");
  const [incidents, setIncidents] = useState<VerifiedIncident[]>([]);
  const [debunked, setDebunked] = useState<DebunkedReport[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const [incidentsRes, debunkedRes] = await Promise.all([
          fetch(`${API_BASE}/api/incidents`),
          fetch(`${API_BASE}/api/debunked`),
        ]);
        if (!incidentsRes.ok || !debunkedRes.ok) throw new Error("bad status");
        const incidentsData: VerifiedIncident[] = await incidentsRes.json();
        const debunkedData: DebunkedReport[] = await debunkedRes.json();
        if (!cancelled) {
          setIncidents(incidentsData);
          setDebunked(debunkedData);
          setOnline(true);
        }
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-800 bg-slate-900/60">
      {/* Tabs */}
      <div className="grid grid-cols-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setTab("live")}
          className={`flex items-center justify-center gap-2 px-3 py-3 text-xs font-semibold tracking-wide transition-colors ${
            tab === "live"
              ? "border-b-2 border-red-500 bg-red-500/10 text-red-400"
              : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          }`}
        >
          <Radio className="h-4 w-4" />
          LIVE INCIDENTS
          <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] text-red-300">
            {incidents.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("debunked")}
          className={`flex items-center justify-center gap-2 px-3 py-3 text-xs font-semibold tracking-wide transition-colors ${
            tab === "debunked"
              ? "border-b-2 border-amber-500 bg-amber-500/10 text-amber-400"
              : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          }`}
        >
          <ShieldX className="h-4 w-4" />
          DISINFO CAUGHT
          <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">
            {debunked.length}
          </span>
        </button>
      </div>

      {/* Offline banner */}
      {!online && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <WifiOff className="h-4 w-4 shrink-0" />
          API offline — start the backend on :8000. Retrying…
        </div>
      )}

      {/* Lists */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {tab === "live" &&
          (incidents.length === 0 ? (
            <EmptyState label="No verified incidents yet — awaiting feed." />
          ) : (
            incidents.map((incident) => (
              <article
                key={incident.id}
                className="rounded-lg border border-slate-700/80 bg-slate-900 p-3.5 shadow"
              >
                <div className="flex items-center gap-2">
                  <EventIcon
                    eventType={incident.event_type}
                    className="h-4 w-4 shrink-0 text-red-400"
                  />
                  <h2 className="text-sm font-bold text-slate-100">
                    {titleCase(incident.event_type)}
                  </h2>
                  <span className="ml-auto font-mono text-[11px] text-slate-500">
                    {incident.id}
                  </span>
                </div>

                <p className="mt-2 text-xs text-slate-300">{incident.summary}</p>

                {/* Confidence bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Confidence</span>
                    <span className="font-semibold text-emerald-400">
                      {confidencePercent(incident.confidence_score)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded bg-slate-700">
                    <div
                      className="h-1.5 rounded bg-emerald-500"
                      style={{ width: `${incident.confidence_score * 100}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {incident.report_count} source
                    {incident.report_count === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {timeAgo(incident.last_seen)}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {incident.source_ids.map((sourceId) => (
                    <span
                      key={sourceId}
                      className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                    >
                      {sourceId}
                    </span>
                  ))}
                </div>
              </article>
            ))
          ))}

        {tab === "debunked" &&
          (debunked.length === 0 ? (
            <EmptyState label="Nothing debunked yet — the filter is watching." />
          ) : (
            debunked.map((report) => (
              <article
                key={report.id}
                className="rounded-lg border border-amber-500/30 bg-slate-900 p-3.5 shadow"
              >
                <div className="flex items-center gap-2">
                  <ShieldX className="h-4 w-4 shrink-0 text-amber-400" />
                  <h2 className="truncate text-sm font-bold text-slate-100">
                    {report.author}
                  </h2>
                  <span className="ml-auto shrink-0 font-mono text-[11px] uppercase text-slate-500">
                    {report.source} · {timeAgo(report.timestamp)}
                  </span>
                </div>

                <p className="mt-2 line-clamp-3 text-xs italic text-slate-400">
                  “{report.text}”
                </p>

                {/* The judge-facing money shot: WHY the AI filter rejected it */}
                <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[10px] font-bold tracking-widest text-amber-400">
                    AI FILTER — FLAGGED
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-amber-200">
                    {report.reason_flagged}
                  </p>
                </div>

                <p className="mt-2 text-[11px] text-slate-500">
                  Credibility score:{" "}
                  <span className="font-semibold text-amber-400">
                    {confidencePercent(report.credibility_score)}
                  </span>
                </p>
              </article>
            ))
          ))}
      </div>
    </aside>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-700 text-center text-xs text-slate-500">
      {label}
    </div>
  );
}
