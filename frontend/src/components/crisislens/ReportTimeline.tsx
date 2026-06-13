"use client";

import { useMemo } from "react";
import { safeNewDate } from "@/lib/format";
import { type CrisisReport } from "@/lib/mockReports";
import { TRUST_LEVELS, TRUST_META, trustLevel, type TrustLevel } from "@/lib/trust";

interface ReportTimelineProps {
  reports: CrisisReport[];
}

/** Number of hours to show. */
const BUCKET_COUNT = 12;
const HOUR_MS = 3_600_000;

interface Bucket {
  start: number;
  end: number;
  counts: Record<TrustLevel, number>;
  total: number;
}

// Stack order within a bar: least-trusted at the bottom, most-trusted on top.
const STACK_ORDER: TrustLevel[] = ["low", "medium", "high"];

function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

/**
 * Signal-volume chart for the news rail: fixed 12-hour window with 
 * 1-hour buckets aligned to full hour boundaries.
 */
export default function ReportTimeline({ reports }: ReportTimelineProps) {
  const { buckets, maxTotal } = useMemo(() => {
    const now = new Date();
    // Align to the start of the current hour
    const endOfCurrentHour = new Date(now);
    endOfCurrentHour.setMinutes(0, 0, 0);
    // The "current" bucket actually ends at the next full hour
    const chartEnd = endOfCurrentHour.getTime() + HOUR_MS;
    
    const slots: Bucket[] = Array.from({ length: BUCKET_COUNT }, (_, i) => {
      const start = chartEnd - (BUCKET_COUNT - i) * HOUR_MS;
      return {
        start,
        end: start + HOUR_MS,
        counts: { high: 0, medium: 0, low: 0 },
        total: 0,
      };
    });

    for (const report of reports) {
      const time = safeNewDate(report.timestamp).getTime();
      const idx = slots.findIndex(s => time >= s.start && time < s.end);
      if (idx !== -1) {
        slots[idx].counts[trustLevel(report.confidence)]++;
        slots[idx].total++;
      }
    }

    return {
      buckets: slots,
      maxTotal: Math.max(...slots.map((b) => b.total), 1),
    };
  }, [reports]);

  const total = buckets.reduce((s, b) => s + b.total, 0);

  // Tick positions: show every 3rd hour for clarity
  const tickIndices = [0, 3, 6, 9, BUCKET_COUNT - 1];

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Signal volume · Last 12h
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-foreground">
          {total} signal{total === 1 ? "" : "s"}
        </span>
      </div>

      {/* Chart area */}
      <div className="relative flex h-20 items-end gap-[3px] border-b border-border/60 pb-px">
        {/* Faint gridline at the maximum */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1 border-t border-dashed border-border/50"
          aria-hidden
        />
        {buckets.map((bucket, i) => (
          <div key={i} className="group relative h-full flex-1">
            {bucket.total > 0 ? (
              <div
                className="absolute bottom-0 flex w-full flex-col-reverse overflow-hidden rounded-t-[3px]"
                style={{ height: `${(bucket.total / maxTotal) * 92 + 6}%` }}
              >
                {STACK_ORDER.map((level) =>
                  bucket.counts[level] > 0 ? (
                    <div
                      key={level}
                      className="w-full transition-all duration-300"
                      style={{
                        flexGrow: bucket.counts[level],
                        background: TRUST_META[level].color,
                        opacity: 0.9,
                      }}
                    />
                  ) : null,
                )}
              </div>
            ) : (
              // Empty bucket: a faint stub keeps the axis rhythm readable.
              <div className="absolute bottom-0 h-[3px] w-full rounded-t-[2px] bg-muted opacity-50" />
            )}

            {/* Hover tooltip */}
            {bucket.total > 0 && (
              <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-card px-2 py-1 text-[10px] opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                <span className="font-mono tabular-nums text-foreground">
                  {bucket.total} signal{bucket.total === 1 ? "" : "s"}
                </span>
                <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                  {clockLabel(bucket.start)}–{clockLabel(bucket.end)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* X-axis ticks */}
      <div className="relative h-3.5">
        {tickIndices.map((index) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
            style={{
              left: `${((index + 0.5) / BUCKET_COUNT) * 100}%`,
            }}
          >
            {index === BUCKET_COUNT - 1
              ? "now"
              : clockLabel(buckets[index].start)}
          </span>
        ))}
      </div>

      {/* Trust legend */}
      <div className="flex items-center gap-3">
        {TRUST_LEVELS.map((level) => (
          <span key={level} className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: TRUST_META[level].color }}
              aria-hidden
            />
            <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
              {TRUST_META[level].label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
