"use client";

import { useEffect, useState } from "react";

/** Sub-score colour: green = strong evidence, amber = mixed, red = weak. */
function strengthColor(value: number): string {
  if (value >= 70) return "#34d399";
  if (value >= 45) return "#fbbf24";
  return "#f87171";
}

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

const SIZE = 156;
const RADIUS = 62;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Animated circular gauge for the AI-assisted plausibility estimate.
 * Counts up from 0 on mount — re-key it per report to replay.
 */
export default function ConfidenceRing({
  value,
  color,
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

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#1b2a45"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - shown / 100)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-4xl font-semibold tabular-nums">
            {Math.round(shown)}%
          </span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            AI-assisted
          </span>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Plausibility estimate — not a ground-truth verdict
      </p>

      <div className="mt-4 w-full space-y-2.5">
        {breakdown.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-[11px] text-slate-400">
              {item.label}
            </span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-night-700">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${item.value * progress}%`,
                  background: strengthColor(item.value),
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-300">
              {Math.round(item.value * progress)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
