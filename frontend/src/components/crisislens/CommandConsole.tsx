"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Megaphone, Radio, type LucideIcon } from "lucide-react";

import type { CrisisReport } from "@/lib/mockReports";
import { derivePulse, type Narrative } from "@/lib/mediaResponse";
import type { PlacedMeasure } from "@/lib/measures";
import PublicPulsePanel from "./PublicPulsePanel";
import MediaResponseConsole from "./MediaResponseConsole";
import MeasuresPanel from "./MeasuresPanel";

type ConsoleTab = "pulse" | "plan" | "respond";

function TabButton({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        active
          ? "border-gold text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-gold" : ""}`} aria-hidden />
      {label}
      {badge && (
        <span className="rounded-full bg-red-600 px-1.5 py-px font-mono text-[9px] font-bold text-white dark:bg-red-500">
          {badge}
        </span>
      )}
    </button>
  );
}

interface CommandConsoleProps {
  city: string;
  /** Reports already scoped to the focused city. */
  reports: CrisisReport[];
  /** Measures Layer state — owned by the Dashboard. */
  measures: PlacedMeasure[];
  /** Incident centroid for distances in the Plan tab. */
  origin: [number, number] | null;
  selectedMeasureId: string | null;
  hoveredMeasureId: string | null;
  onSelectMeasure: (id: string | null) => void;
  onHoverMeasure: (id: string | null) => void;
  onUpdateMeasure: (id: string, patch: Partial<PlacedMeasure>) => void;
  onRemoveMeasure: (id: string) => void;
  onClearMeasures: () => void;
}

/**
 * Right-hand Command Mode console: PULSE (listen) · PLAN (measures on the
 * map) · RESPOND (manage the media response). All panels stay mounted across
 * tab switches so composer state and the response timeline survive.
 */
export default function CommandConsole({
  city,
  reports,
  measures,
  origin,
  selectedMeasureId,
  hoveredMeasureId,
  onSelectMeasure,
  onHoverMeasure,
  onUpdateMeasure,
  onRemoveMeasure,
  onClearMeasures,
}: CommandConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>("pulse");
  const [counter, setCounter] = useState<Narrative | null>(null);

  const pulse = useMemo(() => derivePulse(city, reports), [city, reports]);
  const debunkedCount = pulse.narratives.filter(
    (n) => n.credibility === "debunked",
  ).length;

  // A counter target belongs to one city's event — drop it on city change.
  useEffect(() => {
    setCounter(null);
    setTab("pulse");
  }, [city]);

  // Selecting a measure on the map brings its editor into view.
  useEffect(() => {
    if (selectedMeasureId) setTab("plan");
  }, [selectedMeasureId]);

  const startCounter = (narrative: Narrative): void => {
    setCounter(narrative);
    setTab("respond");
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Command console"
        className="flex shrink-0 border-b border-border"
      >
        <TabButton
          icon={Radio}
          label="Pulse"
          active={tab === "pulse"}
          badge={debunkedCount > 0 ? String(debunkedCount) : null}
          onClick={() => setTab("pulse")}
        />
        <TabButton
          icon={ClipboardList}
          label="Plan"
          active={tab === "plan"}
          badge={null}
          onClick={() => setTab("plan")}
        />
        <TabButton
          icon={Megaphone}
          label="Respond"
          active={tab === "respond"}
          badge={null}
          onClick={() => setTab("respond")}
        />
      </div>

      {/* Panels — kept mounted so workflow state survives tab switches. */}
      <div
        role="tabpanel"
        aria-label="Public pulse"
        className={tab === "pulse" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
      >
        <PublicPulsePanel pulse={pulse} onCounter={startCounter} />
      </div>
      <div
        role="tabpanel"
        aria-label="Operational plan"
        className={tab === "plan" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
      >
        <MeasuresPanel
          city={city}
          measures={measures}
          origin={origin}
          selectedId={selectedMeasureId}
          hoveredId={hoveredMeasureId}
          onSelect={onSelectMeasure}
          onHover={onHoverMeasure}
          onUpdate={onUpdateMeasure}
          onRemove={onRemoveMeasure}
          onClearAll={onClearMeasures}
        />
      </div>
      <div
        role="tabpanel"
        aria-label="Media response"
        className={tab === "respond" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
      >
        <MediaResponseConsole
          city={city}
          reports={reports}
          counter={counter}
          onClearCounter={() => setCounter(null)}
        />
      </div>
    </div>
  );
}
