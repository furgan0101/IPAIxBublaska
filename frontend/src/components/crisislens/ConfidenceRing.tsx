"use client";

import { useEffect, useState } from "react";

const LEVEL_COLORS = [
  "#ef4444", // Level 1: Red
  "#ea580c", // Level 2: Orange
  "#eab308", // Level 3: Yellow
  "#84cc16", // Level 4: Lime
  "#10b981", // Level 5: Green
];

interface BreakdownItem {
  label: string;
  value: number;
}

interface ConfidenceRingProps {
  /** Target percentage, 0–100. */
  value: number;
  /** Ring colour — matches the report's triage status. */
  color: string;
  breakdown: BreakdownItem[];
}

/**
 * Animated straight horizontal gauge for the AI-assisted plausibility estimate.
 * Counts up from 0 on mount — re-key it per report to replay.
 */
export default function ConfidenceRing({
  value,
  breakdown,
}: ConfidenceRingProps) {
  // Eased 0→1 progress driving the ring, the counter and the bars together.
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const started = performance.now();
    const DURATION_MS = 1100;

    const tick = (now: number): void => {
      const t = Math.min(1, (now - started) / DURATION_MS);
      setProgress(1 - Math.pow(1 - t, 3)); // ease-out cubic
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    // rAF is throttled in hidden/background tabs — make sure the gauge
    // still settles at its target value.
    const fallback = window.setTimeout(() => setProgress(1), DURATION_MS + 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [value]);

  const shown = value * progress;

  // Horizontal bar parameters
  const xStart = 10;
  const xEnd = 190;
  const barWidth = xEnd - xStart; // 180px
  const barHeight = 10;
  const barY = 24;

  const segments = [
    { x: xStart, width: 36, color: "#ef4444" },
    { x: xStart + 36, width: 36, color: "#ea580c" },
    { x: xStart + 72, width: 36, color: "#eab308" },
    { x: xStart + 108, width: 36, color: "#84cc16" },
    { x: xStart + 144, width: 36, color: "#10b981" },
  ];

  // Pointer position based on the animated percentage value
  const xPointer = xStart + (shown / 100) * barWidth;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[52px] w-[200px]">
        <svg width={200} height={52} viewBox="0 0 200 52" className="mx-auto">
          {/* Static Contiguous Color Segments */}
          {segments.map((seg, i) => (
            <rect
              key={i}
              x={seg.x}
              y={barY}
              width={seg.width}
              height={barHeight}
              fill={seg.color}
              className="opacity-95"
            />
          ))}

          {/* Pointer Triangle pointing down to the bar */}
          <polygon
            points={`${xPointer - 4.5},${barY - 7} ${xPointer + 4.5},${barY - 7} ${xPointer},${barY - 1}`}
            fill="var(--foreground)"
            className="opacity-90"
          />

          {/* Labels for the gauge zones */}
          <text
            x={xStart}
            y={barY + barHeight + 12}
            textAnchor="start"
            className="font-sans text-[8px] font-semibold uppercase tracking-[0.12em] fill-muted-foreground"
          >
            Low
          </text>
          <text
            x={(xStart + xEnd) / 2}
            y={barY + barHeight + 12}
            textAnchor="middle"
            className="font-sans text-[8px] font-semibold uppercase tracking-[0.12em] fill-muted-foreground"
          >
            Medium
          </text>
          <text
            x={xEnd}
            y={barY + barHeight + 12}
            textAnchor="end"
            className="font-sans text-[8px] font-semibold uppercase tracking-[0.12em] fill-muted-foreground"
          >
            High
          </text>
        </svg>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Plausibility estimate — not a ground-truth verdict
      </p>

      <div className="mt-5 w-full space-y-3">
        {breakdown.map((item) => {
          const animatedValue = item.value * progress;
          const animatedLevel = animatedValue / 20; // 0 to 5
          const displayLevel = Math.max(1, Math.min(5, Math.ceil(animatedLevel)));

          return (
            <div key={item.label} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-[11px] text-muted-foreground">
                {item.label}
              </span>
              <div className="flex flex-1 gap-1 min-w-0">
                {[0, 1, 2, 3, 4].map((i) => {
                  const fillPercent = Math.max(0, Math.min(100, (animatedLevel - i) * 100));
                  return (
                    <div
                      key={i}
                      className="h-1.5 flex-1 overflow-hidden rounded-sm bg-muted"
                    >
                      {fillPercent > 0 && (
                        <div
                          className="h-full rounded-sm transition-all duration-300"
                          style={{
                            width: `${fillPercent}%`,
                            backgroundColor: LEVEL_COLORS[i],
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
                {displayLevel} / 5
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
