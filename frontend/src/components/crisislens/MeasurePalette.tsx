"use client";

import {
  MEASURE_KINDS,
  MEASURE_KIND_ORDER,
  type MeasureKind,
} from "@/lib/measures";

interface MeasurePaletteProps {
  armed: MeasureKind | null;
  onArm: (kind: MeasureKind | null) => void;
}

/**
 * Floating symbol palette on the map (Command Mode only). Arm a tool, then
 * click the map — or press Enter — to drop the marker. Clicking the armed
 * tool again (or Escape) disarms it.
 */
export default function MeasurePalette({ armed, onArm }: MeasurePaletteProps) {
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-[1000] w-44 rounded-lg border border-border bg-card/95 shadow-sm">
      <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Plan measures
      </p>

      <div
        role="toolbar"
        aria-label="Measure tools"
        aria-orientation="vertical"
        className="grid grid-cols-2 gap-1 p-1.5"
      >
        {MEASURE_KIND_ORDER.map((kind) => {
          const meta = MEASURE_KINDS[kind];
          const isArmed = armed === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={isArmed}
              aria-label={`${meta.labelEn} (${meta.labelDe})`}
              title={`${meta.labelDe} · ${meta.labelEn}`}
              onClick={() => onArm(isArmed ? null : kind)}
              className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isArmed
                  ? "border-gold bg-gold-fill/15"
                  : "border-transparent hover:bg-muted"
              }`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-white"
                style={{ background: meta.color }}
                aria-hidden
              >
                <meta.icon size={12} strokeWidth={2.25} />
              </span>
              <span className="min-w-0 truncate text-[10px] font-medium leading-tight text-foreground">
                {meta.labelDe}
              </span>
            </button>
          );
        })}
      </div>

      <p
        className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground"
        aria-live="polite"
      >
        {armed ? (
          <>
            <span className="font-semibold text-gold">
              {MEASURE_KINDS[armed].labelDe} armed
            </span>{" "}
            — click the map or press Enter to place · Esc cancels
          </>
        ) : (
          "Arm a tool, then click the map to place it"
        )}
      </p>
    </div>
  );
}
