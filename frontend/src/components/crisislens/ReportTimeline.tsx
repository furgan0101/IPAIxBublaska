"use client";

import { useMemo } from "react";
import { safeNewDate } from "@/lib/format";
import type { CrisisReport } from "@/lib/mockReports";

interface ReportTimelineProps {
  reports: CrisisReport[];
}

/** Number of hourly buckets to display. */
const BUCKET_COUNT = 12;

/**
 * 12-hour bar chart showing report volume per hour — styled like a
 * Downdetector-style area/bar chart with the CrisisLens dark palette.
 */
export default function ReportTimeline({ reports }: ReportTimelineProps) {
  const { buckets, labels, maxCount } = useMemo(() => {
    const now = Date.now();
    const msPerBucket = 3_600_000; // 1 hour

    // Initialise empty buckets (oldest first → newest last).
    const counts = new Array<number>(BUCKET_COUNT).fill(0);

    for (const report of reports) {
      const age = now - safeNewDate(report.timestamp).getTime();
      const idx = BUCKET_COUNT - 1 - Math.floor(age / msPerBucket);
      if (idx >= 0 && idx < BUCKET_COUNT) {
        counts[idx]++;
      }
    }

    // Generate hour labels for the x-axis (every 2 hours).
    const hourLabels: { index: number; text: string }[] = [];
    for (let i = 0; i < BUCKET_COUNT; i++) {
      if (i % 2 === 0 || i === BUCKET_COUNT - 1) {
        const bucketTime = new Date(now - (BUCKET_COUNT - 1 - i) * msPerBucket);
        hourLabels.push({
          index: i,
          text: `${bucketTime.getHours()}h`,
        });
      }
    }

    return {
      buckets: counts,
      labels: hourLabels,
      maxCount: Math.max(...counts, 1), // avoid division by zero
    };
  }, [reports]);

  const total = buckets.reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          12h Signal Volume
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-foreground">
          {total} signals
        </span>
      </div>

      {/* Chart area */}
      <div className="relative flex h-16 items-end gap-px">
        {buckets.map((count, i) => {
          const pct = (count / maxCount) * 100;
          // Colour: gold accent for bars with reports, muted for empty.
          const hasReports = count > 0;
          return (
            <div
              key={i}
              className="group relative flex-1"
              style={{ height: "100%" }}
            >
              {/* The bar itself */}
              <div
                className="absolute bottom-0 w-full rounded-t-sm transition-all duration-300"
                style={{
                  height: hasReports ? `${Math.max(pct, 6)}%` : "3%",
                  background: hasReports
                    ? "var(--gold-fill)"
                    : "var(--muted)",
                  opacity: hasReports ? 0.85 : 0.4,
                }}
              />

              {/* Hover tooltip */}
              {hasReports && (
                <div className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  {count}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="relative h-4">
        {labels.map(({ index, text }) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
            style={{
              left: `${(index / (BUCKET_COUNT - 1)) * 100}%`,
            }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
