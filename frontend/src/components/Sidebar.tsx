"use client";

import { Clock, ExternalLink, Radio, ShieldX, Users } from "lucide-react";

import IncidentDetail from "@/components/IncidentDetail";
import { EventIcon, eventMeta } from "@/lib/eventMeta";
import { confidencePercent, timeAgo } from "@/lib/format";
import type { DebunkedReport, Severity, VerifiedIncident } from "@/lib/types";

export type Tab = "live" | "debunked";

const SEVERITY_BADGE: Record<Severity, string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-300",
  moderate: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  low: "border-slate-600 bg-slate-700/30 text-slate-300",
};

/** Maps a reason_flagged onto the verification rule that fired. */
function flagRule(reason: string): string {
  if (reason.startsWith("Recycled footage")) return "TEMPORAL CHECK";
  if (reason.startsWith("Geotag conflict")) return "SPATIAL CHECK";
  if (reason.startsWith("Bot-spam")) return "LINGUISTIC CHECK";
  if (reason.startsWith("AI Parsing")) return "OUTPUT GUARD";
  return "AI ANALYST";
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-800 bg-slate-900 p-3.5">
      <div className="h-3.5 w-2/5 rounded bg-slate-800" />
      <div className="mt-3 h-2.5 w-full rounded bg-slate-800/80" />
      <div className="mt-2 h-2.5 w-4/5 rounded bg-slate-800/80" />
      <div className="mt-4 h-1.5 w-full rounded bg-slate-800/60" />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-700 px-6 text-center text-xs text-slate-500">
      {label}
    </div>
  );
}

interface SidebarProps {
  incidents: VerifiedIncident[] | null;
  debunked: DebunkedReport[] | null;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  selectedIncident: VerifiedIncident | null;
  hoverId: string | null;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onHover: (id: string | null) => void;
}

export default function Sidebar({
  incidents,
  debunked,
  tab,
  onTabChange,
  selectedIncident,
  hoverId,
  onSelect,
  onClearSelection,
  onHover,
}: SidebarProps) {
  const loading = incidents === null;

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-800 bg-slate-900/60">
      {/* Tabs */}
      <div className="grid grid-cols-2 border-b border-slate-800" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          onClick={() => onTabChange("live")}
          className={`flex items-center justify-center gap-2 px-3 py-3 text-xs font-semibold tracking-wide transition-colors ${
            tab === "live"
              ? "border-b-2 border-red-500 bg-red-500/10 text-red-400"
              : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          }`}
        >
          <Radio className="h-4 w-4" aria-hidden />
          LIVE INCIDENTS
          <span className="rounded-full bg-red-500/20 px-1.5 font-mono text-[10px] text-red-300">
            {incidents?.length ?? "–"}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "debunked"}
          onClick={() => onTabChange("debunked")}
          className={`flex items-center justify-center gap-2 px-3 py-3 text-xs font-semibold tracking-wide transition-colors ${
            tab === "debunked"
              ? "border-b-2 border-amber-500 bg-amber-500/10 text-amber-400"
              : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          }`}
        >
          <ShieldX className="h-4 w-4" aria-hidden />
          DISINFO CAUGHT
          <span className="rounded-full bg-amber-500/20 px-1.5 font-mono text-[10px] text-amber-300">
            {debunked?.length ?? "–"}
          </span>
        </button>
      </div>

      {/* Detail dossier replaces the live list when an incident is selected */}
      {tab === "live" && selectedIncident ? (
        <IncidentDetail incident={selectedIncident} onBack={onClearSelection} />
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {tab === "live" &&
            (loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : incidents.length === 0 ? (
              <EmptyState label="No verified incidents in this view — adjust the filter or await the feed." />
            ) : (
              incidents.map((incident, index) => {
                const meta = eventMeta(incident.event_type);
                const hovered = incident.id === hoverId;
                return (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() => onSelect(incident.id)}
                    onMouseEnter={() => onHover(incident.id)}
                    onMouseLeave={() => onHover(null)}
                    style={{ animationDelay: `${index * 45}ms` }}
                    className={`animate-fade-up block w-full rounded-lg border bg-slate-900 p-3.5 text-left shadow transition-colors ${
                      hovered
                        ? "border-cyan-400/60"
                        : "border-slate-700/80 hover:border-slate-500"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <EventIcon
                        eventType={incident.event_type}
                        className={`h-4 w-4 shrink-0 ${meta.color}`}
                      />
                      <h2 className="text-sm font-bold text-slate-100">
                        {meta.label}
                      </h2>
                      <span
                        className={`rounded-full border px-1.5 py-px text-[8px] font-bold uppercase tracking-widest ${SEVERITY_BADGE[incident.severity]}`}
                      >
                        {incident.severity}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-slate-500">
                        {incident.id}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-slate-300">{incident.summary}</p>

                    {/* Action hint preview */}
                    <p className="mt-2 line-clamp-1 border-l-2 border-cyan-400/60 pl-2 text-[11px] text-cyan-200/90">
                      {incident.action_hint}
                    </p>

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
                          className="h-1.5 rounded bg-emerald-500 transition-all duration-500"
                          style={{ width: `${incident.confidence_score * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {incident.report_count} source
                        {incident.report_count === 1 ? "" : "s"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {timeAgo(incident.last_seen)}
                      </span>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600">
                        details →
                      </span>
                    </div>
                  </button>
                );
              })
            ))}

          {tab === "debunked" &&
            (debunked === null ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : debunked.length === 0 ? (
              <EmptyState label="Nothing debunked in this view — the filter is watching." />
            ) : (
              debunked.map((report, index) => (
                <article
                  key={report.id}
                  style={{ animationDelay: `${index * 45}ms` }}
                  className="animate-fade-up rounded-lg border border-amber-500/30 bg-slate-900 p-3.5 shadow"
                >
                  <div className="flex items-center gap-2">
                    <ShieldX className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                    <h2 className="truncate text-sm font-bold text-slate-100">
                      {report.author}
                    </h2>
                    <span className="ml-auto shrink-0 font-mono text-[11px] uppercase text-slate-500">
                      {report.source} · {timeAgo(report.timestamp)}
                    </span>
                    {report.url && (
                      <a
                        href={report.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 text-slate-500 transition-colors hover:text-amber-400"
                        aria-label="View original post"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>

                  <p className="mt-2 line-clamp-3 text-xs italic text-slate-400">
                    “{report.text}”
                  </p>

                  {/* WHY it was rejected — rule badge + reason */}
                  <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold tracking-widest text-amber-400">
                        AI FILTER — FLAGGED
                      </p>
                      <span className="rounded border border-amber-500/40 px-1.5 py-px font-mono text-[8px] tracking-widest text-amber-300">
                        {flagRule(report.reason_flagged)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-amber-200">
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
      )}
    </aside>
  );
}
