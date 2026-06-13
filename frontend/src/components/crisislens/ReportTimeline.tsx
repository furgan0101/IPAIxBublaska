"use client";

import { useMemo } from "react";
import { safeNewDate } from "@/lib/format";
import { type CrisisReport } from "@/lib/mockReports";
import { TRUST_LEVELS, TRUST_META, trustLevel, type TrustLevel } from "@/lib/trust";

interface ReportTimelineProps {
  reports: CrisisReport[];
  /**
   * When true the bar heights are shaped into a spike-then-decay envelope
   * (used for the Mannheim demo scenario to simulate incident escalation
   * followed by a slow resolution tail).
   */
  decayShape?: boolean;
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
 * Pre-computed spike-then-decay envelope (0–1 scale).
 * Index 0 = oldest bucket, index 11 = current hour ("now").
 *
 * Shape rationale: small ramp-up → sharp spike at index 2 → slow
 * exponential decay over the remaining buckets, bottoming out ~15 %.
 */
const DECAY_ENVELOPE: number[] = (() => {
  const n = BUCKET_COUNT;
  const peak = 2; // which bucket index carries the spike
  const env: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < peak) {
      // Short ramp before the spike
      env.push(0.18 + (i / peak) * 0.42);
    } else if (i === peak) {
      env.push(1.0);
    } else {
      // Exponential decay after peak; half-life ≈ 4 buckets
      const t = i - peak;
      env.push(Math.max(0.13, Math.exp(-t * 0.18)));
    }
  }
  return env;
})();

/**
 * Signal-volume chart for the news rail: fixed 12-hour window with
 * 1-hour buckets aligned to full hour boundaries.
 */
export default function ReportTimeline({ reports, decayShape = false }: ReportTimelineProps) {
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
      const idx = slots.findIndex((s) => time >= s.start && time < s.end);
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

  // Only apply the decay envelope when there is at least some real data.
  const effectiveDecayShape = decayShape && reports.length > 0;

  // Tick positions: show every 3rd hour for clarity
  const tickIndices = [0, 3, 6, 9, BUCKET_COUNT - 1];

  /**
   * Compute the rendered height fraction for each bucket.
   *
   * In decayShape mode we use the envelope directly (with a minimum stub
   * so every bar is visible) and mix in the real count distribution at
   * low weight so the trust-level colouring still makes sense.
   */
  function barHeightPct(bucket: Bucket, index: number): number {
    if (effectiveDecayShape) {
      // 80 % envelope + 20 % real distribution
      const envH = DECAY_ENVELOPE[index];
      const realH = maxTotal > 0 ? bucket.total / maxTotal : 0;
      return (envH * 0.8 + realH * 0.2) * 92 + 6;
    }
    return (bucket.total / maxTotal) * 92 + 6;
  }

  /**
   * In decayShape mode we want every bar to have a visible stack even when
   * real count is 0, so we fabricate a synthetic count distribution based
   * on the envelope weight.
   */
  function stackLevels(bucket: Bucket, index: number): { level: TrustLevel; flex: number }[] {
    if (!effectiveDecayShape) {
      return STACK_ORDER.filter((l) => bucket.counts[l] > 0).map((l) => ({
        level: l,
        flex: bucket.counts[l],
      }));
    }

    // In decay mode: use real counts if available, otherwise synthesise from envelope
    const hasCounts = STACK_ORDER.some((l) => bucket.counts[l] > 0);
    if (hasCounts) {
      return STACK_ORDER.filter((l) => bucket.counts[l] > 0).map((l) => ({
        level: l,
        flex: bucket.counts[l],
      }));
    }

    // Synthesise based on envelope position (early = more high-trust, late = more low-trust)
    const env = DECAY_ENVELOPE[index];
    if (env > 0.7) return [{ level: "high", flex: 1 }];
    if (env > 0.35) return [{ level: "medium", flex: 1 }];
    return [{ level: "low", flex: 1 }];
  }

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
        {buckets.map((bucket, i) => {
          const heightPct = effectiveDecayShape || bucket.total > 0 ? barHeightPct(bucket, i) : null;
          const levels = stackLevels(bucket, i);

          return (
            <div key={i} className="group relative h-full flex-1">
              {heightPct !== null ? (
                <div
                  className="absolute bottom-0 flex w-full flex-col-reverse overflow-hidden rounded-t-[3px]"
                  style={{ height: `${heightPct}%` }}
                >
                  {levels.map(({ level, flex }) => (
                    <div
                      key={level}
                      className="w-full transition-all duration-300"
                      style={{
                        flexGrow: flex,
                        background: TRUST_META[level].color,
                        opacity: 0.9,
                      }}
                    />
                  ))}
                </div>
              ) : (
                // Empty bucket: a faint stub keeps the axis rhythm readable.
                <div className="absolute bottom-0 h-[3px] w-full rounded-t-[2px] bg-muted opacity-50" />
              )}

              {/* Hover tooltip */}
              {(effectiveDecayShape || bucket.total > 0) && (
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
          );
        })}
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
