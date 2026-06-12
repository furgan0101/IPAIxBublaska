"use client";

/** Radial confidence gauge (SVG arc), colored by score band. */
export default function ConfidenceGauge({
  score,
  size = 76,
}: {
  score: number;
  size?: number;
}) {
  const stroke = 7;
  const radius = (size - stroke - 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? "#10b981" : score >= 0.65 ? "#eab308" : "#f97316";

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Confidence ${pct} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1e293b"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference * score} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-mono text-sm font-bold leading-none text-slate-100">
            {pct}%
          </p>
          <p className="mt-0.5 text-[8px] uppercase tracking-widest text-slate-500">
            conf
          </p>
        </div>
      </div>
    </div>
  );
}
