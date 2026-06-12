"use client";

import { useMemo, type ReactNode } from "react";
import { Activity, Gauge, ShieldX, Users } from "lucide-react";

import { useCountUp } from "@/hooks/useCountUp";
import { EventIcon, eventMeta } from "@/lib/eventMeta";
import type { DebunkedReport, VerifiedIncident } from "@/lib/types";

function Kpi({
  icon,
  label,
  value,
  suffix = "",
  frame,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  frame: string;
}) {
  const display = useCountUp(value);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 lg:px-5">
      <div className={`rounded-lg border p-1.5 ${frame}`}>{icon}</div>
      <div>
        <p className="font-mono text-lg font-bold leading-none text-slate-100">
          {display}
          {suffix}
        </p>
        <p className="mt-1 text-[9px] uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
      </div>
    </div>
  );
}

/** SITREP band: global situation numbers + event-type breakdown. */
export default function KpiStrip({
  incidents,
  debunked,
}: {
  incidents: VerifiedIncident[] | null;
  debunked: DebunkedReport[] | null;
}) {
  const stats = useMemo(() => {
    const list = incidents ?? [];
    const sources = list.reduce((sum, i) => sum + i.report_count, 0);
    const avgConfidence =
      list.length > 0
        ? Math.round(
            (list.reduce((sum, i) => sum + i.confidence_score, 0) / list.length) *
              100,
          )
        : 0;
    const byType = new Map<string, number>();
    for (const incident of list) {
      byType.set(incident.event_type, (byType.get(incident.event_type) ?? 0) + 1);
    }
    return { active: list.length, sources, avgConfidence, byType };
  }, [incidents]);

  return (
    <section
      aria-label="Situation overview"
      className="flex items-stretch divide-x divide-slate-800/80 border-b border-slate-800 bg-slate-900/60"
    >
      <Kpi
        icon={<Activity className="h-4 w-4 text-red-400" aria-hidden />}
        frame="border-red-500/30 bg-red-500/10"
        label="Active incidents"
        value={stats.active}
      />
      <Kpi
        icon={<Users className="h-4 w-4 text-slate-300" aria-hidden />}
        frame="border-slate-600/60 bg-slate-700/30"
        label="Corroborating sources"
        value={stats.sources}
      />
      <Kpi
        icon={<ShieldX className="h-4 w-4 text-amber-400" aria-hidden />}
        frame="border-amber-500/30 bg-amber-500/10"
        label="Disinfo caught"
        value={debunked?.length ?? 0}
      />
      <Kpi
        icon={<Gauge className="h-4 w-4 text-emerald-400" aria-hidden />}
        frame="border-emerald-500/30 bg-emerald-500/10"
        label="Avg confidence"
        value={stats.avgConfidence}
        suffix="%"
      />
      <div className="ml-auto hidden items-center gap-2 px-4 md:flex">
        {[...stats.byType.entries()].map(([type, count]) => {
          const meta = eventMeta(type);
          return (
            <span
              key={type}
              title={`${meta.label}: ${count}`}
              className="flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-800/60 px-2.5 py-1"
            >
              <EventIcon eventType={type} className={`h-3.5 w-3.5 ${meta.color}`} />
              <span className="font-mono text-[11px] text-slate-300">{count}</span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
