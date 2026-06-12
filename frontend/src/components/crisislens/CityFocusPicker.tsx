"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Crosshair } from "lucide-react";

import { STATUS_META, type CrisisReport, type ReportStatus } from "@/lib/mockReports";

/** relevant > review > ignored — for the per-city worst-status dot. */
const STATUS_RANK: Record<ReportStatus, number> = {
  relevant: 2,
  review: 1,
  ignored: 0,
};

interface CitySummary {
  city: string;
  count: number;
  escalated: number;
  worst: ReportStatus;
}

interface CityFocusPickerProps {
  reports: CrisisReport[];
  onFocus: (city: string) => void;
}

/**
 * Header dropdown that enters Command Mode for one city. Cities are derived
 * from whatever is on the board, so it works on mock and live data alike.
 */
export default function CityFocusPicker({ reports, onFocus }: CityFocusPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const cities = useMemo<CitySummary[]>(() => {
    const byCity = new Map<string, CitySummary>();
    for (const report of reports) {
      const entry = byCity.get(report.city) ?? {
        city: report.city,
        count: 0,
        escalated: 0,
        worst: "ignored" as ReportStatus,
      };
      entry.count += 1;
      if (report.status === "relevant") entry.escalated += 1;
      if (STATUS_RANK[report.status] > STATUS_RANK[entry.worst]) {
        entry.worst = report.status;
      }
      byCity.set(report.city, entry);
    }
    return [...byCity.values()].sort(
      (a, b) => b.escalated - a.escalated || b.count - a.count || a.city.localeCompare(b.city),
    );
  }, [reports]);

  // Close on click-outside and on Escape (without bubbling into the
  // dashboard's own Escape handling while the menu is open).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-gold/40 bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Crosshair className="h-3.5 w-3.5 text-gold" />
        Command Mode
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Focus a city"
          className="cl-rise absolute right-0 top-full z-[1100] mt-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        >
          <p className="border-b border-border px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Focus a city · scoped command view
          </p>
          <ul className="cl-scroll max-h-80 overflow-y-auto p-1.5">
            {cities.map((entry) => (
              <li key={entry.city}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onFocus(entry.city);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[entry.worst].dot}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                    {entry.city}
                  </span>
                  {entry.escalated > 0 && (
                    <span className="shrink-0 rounded border border-red-600/25 bg-red-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                      {entry.escalated} escalated
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {entry.count} rpt
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
