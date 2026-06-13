"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, ZoomControl, useMap, Circle, useMapEvents, Polyline, Polygon } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { type CrisisReport } from "@/lib/mockReports";
import { TRUST_LEVELS, TRUST_META, trustLevel } from "@/lib/trust";
import { MEASURE_KINDS, type PlacedMeasure, type MeasureKind } from "@/lib/measures";

/** Overview framing for the Baden-Württemberg sector. */
const BW_CENTER: [number, number] = [48.62, 9.05];
const BW_ZOOM = 8;
const FOCUS_ZOOM = 15;

/** Wait for the detail-panel width transition (500 ms) before flying. */
const FLY_DELAY_MS = 560;

const EVENT_EMOJI: Record<string, string> = {
  fire: "🔥",
  wildfire: "🔥",
  flood: "🌊",
  storm: "⛈️",
  earthquake: "📳",
  heatwave: "🌡️",
  cold_spell: "❄️",
  explosion: "💥",
  chemical_accident: "⚗️",
  hazmat: "☣️",
  accident: "🚗",
  infrastructure_failure: "⚙️",
  nuclear_accident: "☢️",
  radiological: "☢️",
  biological: "🦠",
  chemical_attack: "🧪",
  pandemic: "🏥",
  terror_attack: "💣",
  cbrn_attack: "☣️",
  hostage: "🚨",
  sabotage: "🔨",
  power_outage: "⚡",
  telecom_failure: "📵",
  water_supply: "💧",
  food_supply: "🌾",
  supply_chain: "🚚",
  evacuation: "🚶",
};

function nodeIcon(color: string, selected: boolean, emoji?: string): L.DivIcon {
  const size = selected ? 32 : 26;
  const inner = emoji
    ? `<span class="cl-node-icon" style="font-size:${selected ? 14 : 12}px">${emoji}</span>`
    : `<span class="cl-node-core"></span>`;
  return L.divIcon({
    className: "cl-node-wrap",
    html: `<span class="cl-node${selected ? " cl-node--selected" : ""}" style="--node:${color}">${inner}<span class="cl-node-ring"></span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}

function measureIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 28 : 22;
  return L.divIcon({
    className: "cl-measure-pin",
    html: `<span class="cl-node${selected ? " cl-node--selected" : ""}" style="--node:${color}; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; width: ${size}px; height: ${size}px;"><span class="cl-node-core" style="background-color: #ffffff; width: 6px; height: 6px; border-radius: 50%;"></span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}

/**
 * Keeps Leaflet in sync with the surrounding layout: re-measures while the
 * detail panel resizes the map column, and flies to / away from the
 * selected report.
 */
function MapController({
  selected,
  focus,
}: {
  selected: CrisisReport | null;
  focus?: MapFocus | null;
}) {
  const map = useMap();
  const firstRun = useRef(true);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  const prevFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      // 1. If an incident is selected, fly to it (overrides everything else)
      if (selected) {
        map.flyTo(selected.coordinates, Math.max(map.getZoom(), FOCUS_ZOOM), {
          duration: 0.9,
        });
        prevFocusRef.current = null;
        return;
      }

      // 2. If a search focus is provided, fly to it
      if (focus) {
        const focusKey = `${focus.center[0]},${focus.center[1]},${focus.zoom}`;
        if (focusKey !== prevFocusRef.current) {
          map.flyTo(focus.center, focus.zoom, { duration: 0.9 });
          prevFocusRef.current = focusKey;
        }
        return;
      }

      // 3. Otherwise, return to overview
      map.flyTo(BW_CENTER, BW_ZOOM, { duration: 0.9 });
      prevFocusRef.current = null;
    }, FLY_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [map, selected, focus]);

  return null;
}

function MapEventsHandler({
  armedTool,
  onPlaceMeasure,
}: {
  armedTool: MeasureKind | null | undefined;
  onPlaceMeasure: ((position: [number, number]) => void) | undefined;
}) {
  useMapEvents({
    click(e) {
      if (armedTool && onPlaceMeasure) {
        onPlaceMeasure([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

const TILE_URLS = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
} as const;

export interface MapFocus {
  center: [number, number];
  zoom: number;
}

interface CrisisMapProps {
  reports: CrisisReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: "dark" | "light";
  focus?: MapFocus | null;
  
  // Tactical planning measures
  measures?: PlacedMeasure[];
  armedTool?: MeasureKind | null;
  selectedMeasureId?: string | null;
  hoveredMeasureId?: string | null;
  onPlaceMeasure?: (position: [number, number]) => void;
  onSelectMeasure?: (id: string | null) => void;
  onHoverMeasure?: (id: string | null) => void;
  onMoveMeasure?: (id: string, position: [number, number]) => void;
  onResizeZone?: (id: string, radiusM: number) => void;
}

export default function CrisisMap({
  reports,
  selectedId,
  onSelect,
  theme,
  focus,
  measures = [],
  armedTool,
  selectedMeasureId,
  hoveredMeasureId,
  onPlaceMeasure,
  onSelectMeasure,
  onHoverMeasure,
  onMoveMeasure,
  onResizeZone,
}: CrisisMapProps) {
  const selected = reports.find((r) => r.id === selectedId) ?? null;

  // Build icons keyed by "eventType-trustLevel-selected".
  // Falls back to trust-level-only key when eventType is unknown.
  const icons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    const emojiKeys = Object.keys(EVENT_EMOJI);
    TRUST_LEVELS.forEach((level) => {
      const color = TRUST_META[level].color;
      // fallback (no emoji)
      map.set(`${level}-false`, nodeIcon(color, false));
      map.set(`${level}-true`, nodeIcon(color, true));
      // per-event-type variants
      emojiKeys.forEach((et) => {
        map.set(`${et}-${level}-false`, nodeIcon(color, false, EVENT_EMOJI[et]));
        map.set(`${et}-${level}-true`, nodeIcon(color, true, EVENT_EMOJI[et]));
      });
    });
    return map;
  }, []);

  // Compute polygons for cycles of incidents (size >= 3)
  const polygons = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    const reportMap = new Map<string, CrisisReport>();
    
    for (const r of reports) {
      reportMap.set(r.id, r);
      if (!adj.has(r.id)) adj.set(r.id, new Set());
    }
    
    for (const r of reports) {
      if (r.related_incidents) {
        for (const rel of r.related_incidents) {
          if (reportMap.has(rel.incident_id)) {
            adj.get(r.id)!.add(rel.incident_id);
            adj.get(rel.incident_id)!.add(r.id);
          }
        }
      }
    }

    const visited = new Set<string>();
    const components: string[][] = [];
    
    for (const nodeId of adj.keys()) {
      if (!visited.has(nodeId)) {
        const comp: string[] = [];
        const queue = [nodeId];
        visited.add(nodeId);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          comp.push(curr);
          for (const neighbor of adj.get(curr) || []) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        if (comp.length >= 3) {
          components.push(comp);
        }
      }
    }

    return components.map((comp) => {
      const pts = comp.map((id) => reportMap.get(id)!).filter(Boolean);
      if (pts.length < 3) return null;
      
      // Compute centroid
      const lats = pts.map((p) => p.coordinates[0]);
      const lons = pts.map((p) => p.coordinates[1]);
      const cy = lats.reduce((a, b) => a + b, 0) / lats.length;
      const cx = lons.reduce((a, b) => a + b, 0) / lons.length;
      
      // Sort angularly to make a clean polygon boundary
      const sortedPts = [...pts].sort((a, b) => {
        const angleA = Math.atan2(a.coordinates[0] - cy, a.coordinates[1] - cx);
        const angleB = Math.atan2(b.coordinates[0] - cy, b.coordinates[1] - cx);
        return angleA - angleB;
      });

      const isSelectedInvolved = sortedPts.some((p) => p.id === selectedId);
      
      return {
        id: sortedPts.map(p => p.id).join("-"),
        coordinates: sortedPts.map(p => p.coordinates),
        isSelectedInvolved,
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);
  }, [reports, selectedId]);

  return (
    <MapContainer
      center={BW_CENTER}
      zoom={BW_ZOOM}
      className="h-full w-full"
      zoomControl={false}
    >
      <ZoomControl position="topright" />
      <TileLayer
        key={theme}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={TILE_URLS[theme]}
      />

      <MapController selected={selected} focus={focus} />

      {/* Enclosed Cycle Fills */}
      {polygons.map((poly) => (
        <Polygon
          key={poly.id}
          positions={poly.coordinates}
          pathOptions={{
            stroke: false,
            fillColor: "#ef4444",
            fillOpacity: poly.isSelectedInvolved ? 0.15 : 0.08,
          }}
        />
      ))}

      {/* Connection Edges */}
      {reports.map((report) => {
        if (!report.related_incidents) return null;
        return report.related_incidents.map((rel) => {
          const target = reports.find((r) => r.id === rel.incident_id);
          if (!target) return null;
          
          const isInvolved = report.id === selectedId || target.id === selectedId;

          return (
            <Polyline
              key={`${report.id}-${target.id}`}
              positions={[report.coordinates, target.coordinates]}
              pathOptions={{
                color: isInvolved ? "#ef4444" : "#f87171",
                weight: isInvolved ? 3 : 1.5,
                dashArray: "8, 8",
                opacity: isInvolved ? 0.8 : 0.4,
              }}
            />
          );
        });
      })}

      {reports.map((report) => {
        const isSelected = report.id === selectedId;
        const level = trustLevel(report.confidence);
        const meta = TRUST_META[level];
        return (
          // Key includes selection so the divIcon swaps cleanly.
          <Marker
            key={`${report.id}-${isSelected}`}
            position={report.coordinates}
            icon={
              report.eventType
                ? icons.get(`${report.eventType}-${level}-${isSelected}`) ?? icons.get(`${level}-${isSelected}`)
                : icons.get(`${level}-${isSelected}`)
            }
            zIndexOffset={isSelected ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(report.id) }}
          >
            <Tooltip
              direction="top"
              offset={[0, -6]}
              opacity={1}
              className="cl-tooltip"
            >
              <div className="min-w-[170px] space-y-1 text-xs">
                <p className="font-semibold text-foreground">
                  {report.crisisType}
                </p>
                <p className="text-muted-foreground">{report.city}</p>
                <p className="flex items-center justify-between gap-4 pt-0.5">
                  <span className={`font-semibold ${meta.text}`}>
                    {meta.label}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {report.confidence}%
                  </span>
                </p>
              </div>
            </Tooltip>
          </Marker>
        );
      })}

      {/* Map click listener when tool is armed */}
      <MapEventsHandler armedTool={armedTool} onPlaceMeasure={onPlaceMeasure} />

      {/* Render placed measures */}
      {measures.map((measure) => {
        const isSelected = measure.id === selectedMeasureId;
        const isHovered = measure.id === hoveredMeasureId;
        const meta = MEASURE_KINDS[measure.kind];
        if (!meta) return null;

        return (
          <div key={measure.id}>
            {measure.kind === "zone" && measure.radiusM && (
              <Circle
                center={measure.position}
                radius={measure.radiusM}
                pathOptions={{
                  color: meta.color,
                  weight: isSelected ? 2.5 : isHovered ? 2 : 1.5,
                  opacity: 0.8,
                  fillColor: meta.color,
                  fillOpacity: isSelected ? 0.16 : isHovered ? 0.12 : 0.08,
                }}
              />
            )}
            <Marker
              position={measure.position}
              icon={measureIcon(meta.color, isSelected || isHovered)}
              zIndexOffset={isSelected ? 1100 : isHovered ? 1050 : 500}
              eventHandlers={{
                click: () => onSelectMeasure && onSelectMeasure(measure.id),
                mouseover: () => onHoverMeasure && onHoverMeasure(measure.id),
                mouseout: () => onHoverMeasure && onHoverMeasure(null),
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -6]}
                className="cl-tooltip"
              >
                <div className="min-w-[120px] space-y-1 text-xs">
                  <p className="font-semibold text-foreground">
                    {measure.label}
                  </p>
                  <p className="text-muted-foreground">{meta.labelEn}</p>
                  {measure.note && (
                    <p className="mt-1 border-t border-border/50 pt-1 text-[10px] italic text-muted-foreground">
                      {measure.note}
                    </p>
                  )}
                </div>
              </Tooltip>
            </Marker>
          </div>
        );
      })}
    </MapContainer>
  );
}
