"use client";

import { Gauge } from "lucide-react";
import TagFilter, { type TagCount } from "./TagFilter";

interface FilterToolbarProps {
  tagCounts: TagCount[];
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;
  minConfidence: number;
  setMinConfidence: (val: number) => void;
}

/**
 * Horizontal toolbar above the map for signal filtering:
 * tags (event type) and confidence (LLM score).
 */
export default function FilterToolbar({
  tagCounts,
  activeTag,
  setActiveTag,
  minConfidence,
  setMinConfidence,
}: FilterToolbarProps) {
  const confidenceValue = Math.max(1, Math.min(5, Math.ceil(minConfidence / 20) || 1));

  return (
    <div className="flex shrink-0 items-center justify-between gap-6 border-b border-border bg-card px-6 py-2">
      <div className="flex min-w-0 items-center gap-4">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Filters:
        </span>
        <TagFilter
          tags={tagCounts}
          active={activeTag}
          onChange={setActiveTag}
        />
      </div>

      <div className="flex shrink-0 items-center gap-4 border-l border-border pl-6">
        <div className="flex items-center gap-2.5">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Min Confidence
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={confidenceValue}
              onChange={(e) => setMinConfidence((parseInt(e.target.value, 10) - 1) * 20 + 1)}
              className="cl-confidence-slider relative z-10 h-2 w-32 cursor-pointer appearance-none bg-transparent transition-all"
            />
            {/* Discrete blocks track */}
            <div className="absolute inset-0 flex gap-1 py-0.25" aria-hidden>
              {["#ef4444", "#ea580c", "#eab308", "#84cc16", "#10b981"].map((color, i) => (
                <div
                  key={i}
                  className="h-full flex-1 rounded-sm opacity-90"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <span className="min-w-[3ch] font-mono text-xs font-semibold tabular-nums text-foreground">
            {confidenceValue} / 5
          </span>
        </div>
      </div>
    </div>
  );
}
