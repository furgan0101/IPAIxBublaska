"use client";

import { EventIcon, eventMeta } from "@/lib/eventMeta";

export interface TypeCount {
  type: string;
  count: number;
}

/** Event-type filter — drives BOTH the map markers and the sidebar lists. */
export default function FilterChips({
  types,
  active,
  onChange,
}: {
  types: TypeCount[];
  active: string | null;
  onChange: (type: string | null) => void;
}) {
  if (types.length === 0) return null;

  const chipBase =
    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors";
  const idle =
    "border-slate-700/80 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-slate-200";
  const activeStyle = "border-cyan-400/60 bg-cyan-400/10 text-cyan-300";

  return (
    <div
      role="group"
      aria-label="Filter incidents by event type"
      className="panel-glass absolute left-4 top-4 z-[1000] flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-1.5 rounded-full p-1.5"
    >
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => onChange(null)}
        className={`${chipBase} ${active === null ? activeStyle : idle}`}
      >
        All
      </button>
      {types.map(({ type, count }) => {
        const meta = eventMeta(type);
        const isActive = active === type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(isActive ? null : type)}
            className={`${chipBase} ${isActive ? activeStyle : idle}`}
          >
            <EventIcon
              eventType={type}
              className={`h-3.5 w-3.5 ${isActive ? "text-cyan-300" : meta.color}`}
            />
            {meta.label}
            <span className="font-mono text-[10px] opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
