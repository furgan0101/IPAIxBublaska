"use client";

import { Gauge } from "lucide-react";
import TagFilter, { type TagCount } from "./TagFilter";
import CityTypeahead from "./CityTypeahead";
import { type CityHit } from "@/lib/cityGazetteer";

interface FilterToolbarProps {
  tagCounts: TagCount[];
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;
  minConfidence: number;
  setMinConfidence: (val: number) => void;
  regionName: string | null;
  onSelectCity: (hit: CityHit) => void;
  onClearRegion: () => void;
}

/**
 * Horizontal toolbar above the map for signal filtering:
 * region typeahead, tags (event type) and confidence (LLM score).
 */
export default function FilterToolbar({
  tagCounts,
  activeTag,
  setActiveTag,
  minConfidence,
  setMinConfidence,
  regionName,
  onSelectCity,
  onClearRegion,
}: FilterToolbarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-6 border-b border-border bg-card px-6 py-2">
      <div className="flex min-w-0 items-center gap-4">
        <CityTypeahead
          selectedName={regionName}
          onSelect={onSelectCity}
          onClear={onClearRegion}
        />
        <span className="shrink-0 border-l border-border pl-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
              step="0.25"
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
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
          <span className="min-w-[5ch] font-mono text-xs font-semibold tabular-nums text-foreground">
            {minConfidence.toFixed(2)} / 5
          </span>
        </div>
      </div>
    </div>
  );
}
