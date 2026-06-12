"use client";

import { ArrowLeft, Clock, Crosshair, Radius, Users } from "lucide-react";

import ConfidenceGauge from "@/components/ConfidenceGauge";
import { EventIcon, eventMeta } from "@/lib/eventMeta";
import { timeAgo } from "@/lib/format";
import type { Severity, VerifiedIncident } from "@/lib/types";

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-300",
  moderate: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  low: "border-slate-600 bg-slate-700/30 text-slate-300",
};

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-[9px] uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-1 font-mono text-xs text-slate-200">{value}</p>
    </div>
  );
}

/** Full incident dossier: guidance, confidence, and the source timeline. */
export default function IncidentDetail({
  incident,
  onBack,
}: {
  incident: VerifiedIncident;
  onBack: () => void;
}) {
  const meta = eventMeta(incident.event_type);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-xs font-semibold tracking-wide text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        BACK TO INCIDENT LIST
        <span className="ml-auto font-mono text-[10px] text-slate-600">ESC</span>
      </button>

      <div className="animate-fade-up min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-2.5">
            <EventIcon
              eventType={incident.event_type}
              className={`h-6 w-6 ${meta.color}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-100">{meta.label}</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${SEVERITY_STYLE[incident.severity]}`}
              >
                {incident.severity}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              {incident.id} · {incident.lat.toFixed(4)} N, {incident.lon.toFixed(4)} E
            </p>
          </div>
        </div>

        {/* Recommended action — the judge-facing element */}
        <div className="rounded-lg border border-cyan-400/30 border-l-4 border-l-cyan-400 bg-cyan-400/10 px-3 py-2.5">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-300">
            Recommended action
          </p>
          <p className="mt-1 text-xs leading-relaxed text-cyan-50">
            {incident.action_hint}
          </p>
        </div>

        {/* Confidence + stats */}
        <div className="flex items-center gap-4">
          <ConfidenceGauge score={incident.confidence_score} />
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Stat
              icon={<Users className="h-3 w-3" aria-hidden />}
              label="Sources"
              value={`${incident.report_count} independent`}
            />
            <Stat
              icon={<Radius className="h-3 w-3" aria-hidden />}
              label="Radius"
              value="1.0 km"
            />
            <Stat
              icon={<Clock className="h-3 w-3" aria-hidden />}
              label="First seen"
              value={timeAgo(incident.first_seen)}
            />
            <Stat
              icon={<Crosshair className="h-3 w-3" aria-hidden />}
              label="Last update"
              value={timeAgo(incident.last_seen)}
            />
          </div>
        </div>

        {/* Source timeline */}
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Source timeline
          </p>
          <ol className="mt-2 space-y-3 border-l border-slate-800 pl-4">
            {incident.sources.map((source) => (
              <li key={source.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-red-500"
                />
                <div className="flex items-baseline gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-400">
                    {source.source}
                  </span>
                  <span className="truncate text-xs font-semibold text-slate-200">
                    {source.author}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                    {timeAgo(source.timestamp)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-400">
                  {source.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
