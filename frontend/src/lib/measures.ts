"use client";

/**
 * Measures Layer data module — the editable tactical layer of Command Mode.
 *
 * Operational markers (units, shelters, closures, zones …) an official
 * places on the map to plan the response. Client-side only: state lives in
 * React, persisted per city to localStorage so a plan survives a refresh
 * during the demo. No backend, no network.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ambulance,
  CircleDot,
  Construction,
  Flame,
  Package,
  RadioTower,
  Route,
  Shield,
  StickyNote,
  Tent,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/* --------------------------------------------------------------- types */

export type MeasureKind =
  | "command"
  | "fire"
  | "police"
  | "medical"
  | "shelter"
  | "evac"
  | "closure"
  | "hazard"
  | "resource"
  | "note"
  | "zone";

export type MeasureStatus = "planned" | "active" | "done";

export interface PlacedMeasure {
  id: string;
  kind: MeasureKind;
  label: string;
  note: string;
  status: MeasureStatus;
  /** WGS84. */
  position: [number, number];
  /** Zones only — circle radius in METRES. */
  radiusM?: number;
  /** ISO timestamp. */
  createdAt: string;
}

/* ----------------------------------------------------------- kind meta */

export interface MeasureKindMeta {
  labelDe: string;
  labelEn: string;
  icon: LucideIcon;
  /** Solid pin colour — white icon on top, works on both basemaps. */
  color: string;
  /** Zones only — initial radius in metres. */
  defaultRadiusM?: number;
}

export const MEASURE_KINDS: Record<MeasureKind, MeasureKindMeta> = {
  command: { labelDe: "Einsatzleitung", labelEn: "Command post", icon: RadioTower, color: "#7c3aed" },
  fire: { labelDe: "Feuerwehr", labelEn: "Fire unit", icon: Flame, color: "#dc2626" },
  police: { labelDe: "Polizei", labelEn: "Police unit", icon: Shield, color: "#2563eb" },
  medical: { labelDe: "Rettungsdienst", labelEn: "Medical unit", icon: Ambulance, color: "#059669" },
  shelter: { labelDe: "Sammelstelle", labelEn: "Shelter / assembly", icon: Tent, color: "#0891b2" },
  evac: { labelDe: "Evakuierung", labelEn: "Evacuation route", icon: Route, color: "#16a34a" },
  closure: { labelDe: "Straßensperre", labelEn: "Road closure", icon: Construction, color: "#475569" },
  hazard: { labelDe: "Gefahrenstelle", labelEn: "Hazard point", icon: TriangleAlert, color: "#d97706" },
  resource: { labelDe: "Material", labelEn: "Resource", icon: Package, color: "#4f46e5" },
  note: { labelDe: "Hinweis", labelEn: "Note", icon: StickyNote, color: "#78716c" },
  zone: { labelDe: "Zone", labelEn: "Action zone", icon: CircleDot, color: "#ea580c", defaultRadiusM: 500 },
};

/** Palette / list ordering. */
export const MEASURE_KIND_ORDER: readonly MeasureKind[] = [
  "command",
  "fire",
  "police",
  "medical",
  "shelter",
  "evac",
  "closure",
  "hazard",
  "resource",
  "note",
  "zone",
];

export const MEASURE_STATUS_META: Record<
  MeasureStatus,
  { label: string; chip: string; dot: string }
> = {
  planned: {
    label: "Planned",
    chip: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  active: {
    label: "Active",
    chip: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  done: {
    label: "Done",
    chip: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

/** planned → active → done → planned (the panel's quick toggle). */
export function nextStatus(status: MeasureStatus): MeasureStatus {
  if (status === "planned") return "active";
  if (status === "active") return "done";
  return "planned";
}

export function newMeasureId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------------------------------------------ geodesy */

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in metres between two WGS84 points. */
export function geodesicMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Metric display: "850 m" below 1 km, "1.2 km" above. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Point `meters` due east of `center` — anchors the zone resize handle. */
export function destinationEastOf(
  center: [number, number],
  meters: number,
): [number, number] {
  const metersPerDegLon = 111_320 * Math.cos((center[0] * Math.PI) / 180);
  return [center[0], center[1] + meters / Math.max(1, metersPerDegLon)];
}

/* ------------------------------------------------------------ storage */

const STORAGE_PREFIX = "crisislens-measures:";

export function measuresStorageKey(city: string): string {
  return `${STORAGE_PREFIX}${city.toLowerCase().replace(/\s+/g, "-")}`;
}

function isMeasure(value: unknown): value is PlacedMeasure {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.kind === "string" &&
    m.kind in MEASURE_KINDS &&
    typeof m.label === "string" &&
    Array.isArray(m.position) &&
    m.position.length === 2
  );
}

export function loadMeasures(city: string): PlacedMeasure[] {
  try {
    const raw = localStorage.getItem(measuresStorageKey(city));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMeasure) : [];
  } catch {
    return [];
  }
}

export function saveMeasures(city: string, measures: PlacedMeasure[]): void {
  try {
    localStorage.setItem(measuresStorageKey(city), JSON.stringify(measures));
  } catch {
    // Storage unavailable — the plan still works for this session.
  }
}

/** Pretty JSON for the "Export plan" download. */
export function serializePlan(city: string, measures: PlacedMeasure[]): string {
  return JSON.stringify(
    {
      app: "CrisisLens",
      kind: "measure-plan",
      city,
      exportedAt: new Date().toISOString(),
      measureCount: measures.length,
      measures,
    },
    null,
    2,
  );
}

/* --------------------------------------------------------------- hook */

export type MeasuresUpdater = (prev: PlacedMeasure[]) => PlacedMeasure[];

/**
 * Per-city measure state with write-through persistence. Saving happens
 * inside mutations only — switching cities can never write one city's plan
 * under another city's key.
 */
export function useCityMeasures(
  city: string | null,
): [PlacedMeasure[], (updater: MeasuresUpdater) => void] {
  const [measures, setMeasures] = useState<PlacedMeasure[]>([]);
  const cityRef = useRef<string | null>(null);

  useEffect(() => {
    cityRef.current = city;
    setMeasures(city ? loadMeasures(city) : []);
  }, [city]);

  const update = useCallback((updater: MeasuresUpdater): void => {
    setMeasures((prev) => {
      const next = updater(prev);
      if (cityRef.current) saveMeasures(cityRef.current, next);
      return next;
    });
  }, []);

  return [measures, update];
}
