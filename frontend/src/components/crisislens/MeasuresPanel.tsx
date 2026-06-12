"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, Download, Eraser, RefreshCw, Trash2, X } from "lucide-react";

import {
  MEASURE_KINDS,
  MEASURE_STATUS_META,
  formatDistance,
  geodesicMeters,
  nextStatus,
  serializePlan,
  type MeasureStatus,
  type PlacedMeasure,
} from "@/lib/measures";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}

const STATUSES = Object.keys(MEASURE_STATUS_META) as MeasureStatus[];

/** Trigger a client-side JSON download of the current plan. */
function downloadPlan(city: string, measures: PlacedMeasure[]): void {
  const blob = new Blob([serializePlan(city, measures)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `crisislens-plan-${city.toLowerCase().replace(/\s+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ----------------------------------------------------- inline editor */

function MeasureEditor({
  measure,
  onUpdate,
  onRemove,
  onClose,
}: {
  measure: PlacedMeasure;
  onUpdate: (id: string, patch: Partial<PlacedMeasure>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <label
          htmlFor={`label-${measure.id}`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          Label
        </label>
        <input
          id={`label-${measure.id}`}
          type="text"
          value={measure.label}
          onChange={(e) => onUpdate(measure.id, { label: e.target.value })}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div>
        <label
          htmlFor={`note-${measure.id}`}
          className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          Note
        </label>
        <textarea
          id={`note-${measure.id}`}
          value={measure.note}
          rows={2}
          placeholder="Short operational note…"
          onChange={(e) => onUpdate(measure.id, { note: e.target.value })}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Status
          </p>
          <div
            className="flex rounded-md border border-border bg-background p-0.5"
            role="radiogroup"
            aria-label="Measure status"
          >
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={measure.status === status}
                onClick={() => onUpdate(measure.id, { status })}
                className={`flex-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  measure.status === status
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {MEASURE_STATUS_META[status].label}
              </button>
            ))}
          </div>
        </div>

        {measure.kind === "zone" && (
          <div className="w-24 shrink-0">
            <label
              htmlFor={`radius-${measure.id}`}
              className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            >
              Radius (m)
            </label>
            <input
              id={`radius-${measure.id}`}
              type="number"
              min={50}
              max={20000}
              step={50}
              value={measure.radiusM ?? 500}
              onChange={(e) =>
                onUpdate(measure.id, {
                  radiusM: Math.max(50, Math.min(20000, Number(e.target.value) || 50)),
                })
              }
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => onRemove(measure.id)}
          className="flex items-center gap-1.5 rounded-md border border-red-600/30 bg-red-600/5 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-600/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-red-500/30 dark:text-red-400"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
          Delete
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- panel */

interface MeasuresPanelProps {
  city: string;
  measures: PlacedMeasure[];
  /** Incident centroid — distances in the list are measured from here. */
  origin: [number, number] | null;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<PlacedMeasure>) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

/**
 * PLAN — every measure placed on the map for the focused city, with the
 * inline editor for the selected one, distances from the incident centroid,
 * quick actions, export and clear-all.
 */
export default function MeasuresPanel({
  city,
  measures,
  origin,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onUpdate,
  onRemove,
  onClearAll,
}: MeasuresPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimer = useRef<number | null>(null);

  // The two-step "Clear all" arms for 3 s, then falls back to safe.
  useEffect(() => {
    if (!confirmClear) return;
    confirmTimer.current = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    };
  }, [confirmClear]);

  const activeCount = measures.filter((m) => m.status === "active").length;

  return (
    <div className="cl-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
      <section>
        <div className="flex items-center gap-2">
          <SectionLabel>
            Operational plan · {city}
          </SectionLabel>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
            {measures.length} measure{measures.length === 1 ? "" : "s"} ·{" "}
            {activeCount} active
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadPlan(city, measures)}
            disabled={measures.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Download className="h-3 w-3" aria-hidden />
            Export plan
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmClear) {
                setConfirmClear(false);
                onClearAll();
              } else {
                setConfirmClear(true);
              }
            }}
            disabled={measures.length === 0}
            className={`ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
              confirmClear
                ? "border-red-600/40 bg-red-600/10 text-red-700 dark:border-red-500/40 dark:text-red-400"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Eraser className="h-3 w-3" aria-hidden />
            {confirmClear ? "Confirm clear?" : "Clear all"}
          </button>
        </div>
      </section>

      {measures.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
          No measures placed yet. Arm a tool in the{" "}
          <span className="font-semibold text-foreground">Plan measures</span>{" "}
          palette on the map, then click the map to position it. Markers can be
          dragged, edited and removed at any time.
        </p>
      ) : (
        <ul className="space-y-2">
          {measures.map((measure) => {
            const meta = MEASURE_KINDS[measure.kind];
            const statusMeta = MEASURE_STATUS_META[measure.status];
            const isSelected = measure.id === selectedId;
            const isHovered = measure.id === hoveredId;
            return (
              <li
                key={measure.id}
                onMouseEnter={() => onHover(measure.id)}
                onMouseLeave={() => onHover(null)}
                className={`rounded-lg border bg-card p-3 transition-colors ${
                  isSelected
                    ? "border-gold"
                    : isHovered
                      ? "border-foreground/30"
                      : "border-border"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
                    style={{ background: meta.color }}
                    aria-hidden
                  >
                    <meta.icon size={14} strokeWidth={2.25} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">
                      {measure.label}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {meta.labelEn}
                      {origin && (
                        <>
                          {" · "}
                          {formatDistance(
                            geodesicMeters(origin, measure.position),
                          )}{" "}
                          from incident centroid
                        </>
                      )}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusMeta.chip}`}
                  >
                    {statusMeta.label}
                  </span>
                </div>

                {/* Quick actions */}
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(isSelected ? null : measure.id)}
                    aria-label={`${isSelected ? "Deselect" : "Locate"} ${measure.label} on the map`}
                    title="Focus on map"
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isSelected ? (
                      <X className="h-3 w-3" aria-hidden />
                    ) : (
                      <Crosshair className="h-3 w-3" aria-hidden />
                    )}
                    {isSelected ? "Close" : "Locate"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(measure.id, { status: nextStatus(measure.status) })
                    }
                    aria-label={`Set status of ${measure.label} to ${MEASURE_STATUS_META[nextStatus(measure.status)].label}`}
                    title={`→ ${MEASURE_STATUS_META[nextStatus(measure.status)].label}`}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden />
                    {MEASURE_STATUS_META[nextStatus(measure.status)].label}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(measure.id)}
                    aria-label={`Delete ${measure.label}`}
                    title="Delete"
                    className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-600/10 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>

                {isSelected && (
                  <MeasureEditor
                    measure={measure}
                    onUpdate={onUpdate}
                    onRemove={onRemove}
                    onClose={() => onSelect(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The plan is stored locally in this browser per city and can be exported
        as JSON. It is a planning aid — operational orders follow the official
        chain of command.
      </p>
    </div>
  );
}
