"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  GeoJSON,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { Lock } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import "leaflet/dist/leaflet.css";

import { type CrisisReport } from "@/lib/mockReports";
import {
  MEASURE_KINDS,
  MEASURE_STATUS_META,
  destinationEastOf,
  formatDistance,
  geodesicMeters,
  type MeasureKind,
  type MeasureStatus,
  type PlacedMeasure,
} from "@/lib/measures";
import {
  BAND_COLORS,
  confidenceBand,
  confidenceColor,
  confidenceLabel,
  confidenceOpacity,
  type ConfidenceBand,
} from "@/lib/confidence";
import { API_BASE } from "@/lib/types";

/** Overview framing for the Baden-Württemberg sector. */
const BW_CENTER: [number, number] = [48.62, 9.05];
const BW_ZOOM = 8;
const FOCUS_ZOOM = 15;
/** Roadworks are only shown at or above the city-search zoom level. */
const ROADWORKS_MIN_ZOOM = 14;

/** Wait for the detail-panel width transition (500 ms) before flying. */
const FLY_DELAY_MS = 560;

/** Command Mode focus target — the map flies to the city in command. */
export interface MapFocus {
  center: [number, number];
  zoom: number;
}

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

/** Security-classified incidents render as a lock badge, not a signal dot —
 * the marker itself signals "information discipline" clearance. */
function lockIcon(selected: boolean): L.DivIcon {
  const size = selected ? 32 : 26;
  const svg = renderToStaticMarkup(
    createElement(Lock, { size: 13, strokeWidth: 2.5, "aria-hidden": true }),
  );
  return L.divIcon({
    className: "cl-node-wrap",
    html: `<span class="cl-node-lock${selected ? " cl-node-lock--selected" : ""}">${svg}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}

/* ------------------------------------------------------ measures layer */

/** Lazily built divIcons — 11 kinds × 3 statuses × selected × hovered. */
const measureIconCache = new Map<string, L.DivIcon>();

function measureIcon(
  kind: MeasureKind,
  status: MeasureStatus,
  selected: boolean,
  hovered: boolean,
): L.DivIcon {
  const key = `${kind}-${status}-${selected}-${hovered}`;
  const cached = measureIconCache.get(key);
  if (cached) return cached;

  const meta = MEASURE_KINDS[kind];
  const size = selected ? 34 : 28;
  const cls = [
    "cl-measure",
    `cl-measure--${status}`,
    selected ? "cl-measure--selected" : "",
    hovered ? "cl-measure--hover" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const svg = renderToStaticMarkup(
    createElement(meta.icon, { size: 15, strokeWidth: 2.25, "aria-hidden": true }),
  );
  const icon = L.divIcon({
    className: "cl-measure-wrap",
    html: `<span class="${cls}" style="--measure:${meta.color}">${svg}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2],
  });
  measureIconCache.set(key, icon);
  return icon;
}

/** Small white grab-dot on the zone ring for resizing. */
const ZONE_HANDLE_ICON = L.divIcon({
  className: "cl-measure-wrap",
  html: '<span class="cl-zone-handle"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

interface MeasureHandlers {
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onMove: (id: string, position: [number, number]) => void;
}

function MeasureTooltip({ measure }: { measure: PlacedMeasure }) {
  const meta = MEASURE_KINDS[measure.kind];
  return (
    <Tooltip direction="top" offset={[0, -8]} opacity={1} className="cl-tooltip">
      <div className="min-w-[150px] space-y-0.5 text-xs">
        <p className="font-semibold text-foreground">{measure.label}</p>
        <p className="text-muted-foreground">
          {meta.labelEn} · {MEASURE_STATUS_META[measure.status].label}
        </p>
        {measure.kind === "zone" && (
          <p className="font-mono text-muted-foreground">
            {formatDistance(measure.radiusM ?? 0)} radius
          </p>
        )}
      </div>
    </Tooltip>
  );
}

function MeasureMarker({
  measure,
  selected,
  hovered,
  onSelect,
  onHover,
  onMove,
}: {
  measure: PlacedMeasure;
  selected: boolean;
  hovered: boolean;
} & MeasureHandlers) {
  return (
    <Marker
      position={measure.position}
      icon={measureIcon(measure.kind, measure.status, selected, hovered)}
      draggable
      zIndexOffset={selected ? 1200 : 600}
      eventHandlers={{
        click: () => onSelect(measure.id),
        mouseover: () => onHover(measure.id),
        mouseout: () => onHover(null),
        dragend: (e) => {
          const at = (e.target as L.Marker).getLatLng();
          onMove(measure.id, [at.lat, at.lng]);
        },
      }}
    >
      <MeasureTooltip measure={measure} />
    </Marker>
  );
}

/**
 * Action zone: dashed circle + draggable centre pin; when selected, a grab
 * handle on the eastern edge resizes the radius with a live metric readout.
 */
function ZoneMeasure({
  measure,
  selected,
  hovered,
  onSelect,
  onHover,
  onMove,
  onResize,
}: {
  measure: PlacedMeasure;
  selected: boolean;
  hovered: boolean;
  onResize: (id: string, radiusM: number) => void;
} & MeasureHandlers) {
  // Live radius preview while the handle is dragged; committed on release.
  const [preview, setPreview] = useState<number | null>(null);
  const radius = preview ?? measure.radiusM ?? 500;
  const meta = MEASURE_KINDS.zone;

  return (
    <>
      <Circle
        center={measure.position}
        radius={radius}
        pathOptions={{
          color: meta.color,
          weight: selected ? 2.5 : 1.5,
          dashArray: "6 6",
          fillColor: meta.color,
          fillOpacity: selected || hovered ? 0.12 : 0.06,
        }}
        eventHandlers={{ click: () => onSelect(measure.id) }}
      />
      <MeasureMarker
        measure={measure}
        selected={selected}
        hovered={hovered}
        onSelect={onSelect}
        onHover={onHover}
        onMove={onMove}
      />
      {selected && (
        <Marker
          position={destinationEastOf(measure.position, radius)}
          icon={ZONE_HANDLE_ICON}
          draggable
          zIndexOffset={1300}
          eventHandlers={{
            drag: (e) => {
              const at = (e.target as L.Marker).getLatLng();
              setPreview(
                Math.max(
                  50,
                  Math.round(geodesicMeters(measure.position, [at.lat, at.lng])),
                ),
              );
            },
            dragend: (e) => {
              const at = (e.target as L.Marker).getLatLng();
              setPreview(null);
              onResize(
                measure.id,
                Math.max(
                  50,
                  Math.round(geodesicMeters(measure.position, [at.lat, at.lng])),
                ),
              );
            },
          }}
        >
          <Tooltip
            permanent
            direction="right"
            offset={[10, 0]}
            opacity={1}
            className="cl-tooltip"
          >
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatDistance(radius)}
            </span>
          </Tooltip>
        </Marker>
      )}
    </>
  );
}

/** Drops the armed tool on map click — or on Enter, at the map centre. */
function PlacementCatcher({
  armed,
  onPlace,
}: {
  armed: boolean;
  onPlace: (position: [number, number]) => void;
}) {
  const map = useMapEvents({
    click: (e) => {
      if (armed) onPlace([e.latlng.lat, e.latlng.lng]);
    },
  });

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      // Don't hijack Enter from text entry — buttons are fine (arming a
      // palette tool with Enter then drops it at the map centre).
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const centre = map.getCenter();
      onPlace([centre.lat, centre.lng]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, map, onPlace]);

  return null;
}

/**
 * Keeps Leaflet in sync with the surrounding layout: re-measures while the
 * detail panel resizes the map column, and flies to / away from the
 * selected report.
 */
function MapController({
  selected,
  focus,
  panTarget,
}: {
  selected: CrisisReport | null;
  focus: MapFocus | null;
  /** Selected measure — pan (not fly) so plan editing stays in context. */
  panTarget: { id: string; position: [number, number] } | null;
}) {
  const map = useMap();
  const firstRun = useRef(true);
  const lastPannedId = useRef<string | null>(null);
  // De-dup focus flights: a search/city focus that recomputes to the same
  // coordinates (e.g. a live poll re-runs the memo) must not re-centre.
  const lastFocusKey = useRef<string | null>(null);

  // Pan once per measure selection; dragging it must not re-centre the map.
  useEffect(() => {
    if (!panTarget) {
      lastPannedId.current = null;
      return;
    }
    if (lastPannedId.current === panTarget.id) return;
    lastPannedId.current = panTarget.id;
    map.panTo(panTarget.position);
  }, [map, panTarget]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (selected) {
        map.flyTo(selected.coordinates, Math.max(map.getZoom(), FOCUS_ZOOM), {
          duration: 0.9,
        });
        lastFocusKey.current = null;
      } else if (focus) {
        const focusKey = `${focus.center[0]},${focus.center[1]},${focus.zoom}`;
        if (focusKey !== lastFocusKey.current) {
          map.flyTo(focus.center, focus.zoom, { duration: 0.9 });
          lastFocusKey.current = focusKey;
        }
      } else {
        map.flyTo(BW_CENTER, BW_ZOOM, { duration: 0.9 });
        lastFocusKey.current = null;
      }
    }, FLY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [map, selected, focus]);

  return null;
}

function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoom() {
      onZoomChange(map.getZoom());
    },
    zoomend() {
      onZoomChange(map.getZoom());
    },
  });

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  return null;
}

const TILE_URLS = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
} as const;

interface CrisisMapProps {
  reports: CrisisReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  theme: "dark" | "light";
  /** Command Mode: fly to and hold the focused city. */
  focus?: MapFocus | null;
  /** True once the user has run a location search (live-data map behaviour). */
  hasSearched?: boolean;
  /** Measures Layer (Command Mode planning) — all optional. */
  measures?: PlacedMeasure[];
  armedTool?: MeasureKind | null;
  selectedMeasureId?: string | null;
  hoveredMeasureId?: string | null;
  onPlaceMeasure?: (position: [number, number]) => void;
  onSelectMeasure?: (id: string) => void;
  onHoverMeasure?: (id: string | null) => void;
  onMoveMeasure?: (id: string, position: [number, number]) => void;
  onResizeZone?: (id: string, radiusM: number) => void;
}

export default function CrisisMap({
  reports,
  selectedId,
  onSelect,
  theme,
  focus = null,
  hasSearched = false,
  measures = [],
  armedTool = null,
  selectedMeasureId = null,
  hoveredMeasureId = null,
  onPlaceMeasure,
  onSelectMeasure,
  onHoverMeasure,
  onMoveMeasure,
  onResizeZone,
}: CrisisMapProps) {
  const selected = reports.find((r) => r.id === selectedId) ?? null;
  const selectedMeasure =
    measures.find((m) => m.id === selectedMeasureId) ?? null;

  // No-op fallbacks keep the legacy read-only usage untouched.
  const selectMeasure = onSelectMeasure ?? ((): void => {});
  const hoverMeasure = onHoverMeasure ?? ((): void => {});
  const moveMeasure = onMoveMeasure ?? ((): void => {});
  const resizeZone = onResizeZone ?? ((): void => {});

  const [roadworks, setRoadworks] = useState<FeatureCollection | null>(null);
  const [currentZoom, setCurrentZoom] = useState(BW_ZOOM);

  const isZoomedIn = currentZoom >= ROADWORKS_MIN_ZOOM;

  const focusKey = focus ? `${focus.center[0]},${focus.center[1]}` : null;

  useEffect(() => {
    // City cleared → remove overlay immediately
    if (!focusKey) {
      setRoadworks(null);
      return;
    }

    // New city searched → fetch roadworks once (after fly animation settles)
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE}/api/mobidata/roadworks`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.features) setRoadworks(data);
        })
        .catch((err) => console.error("Failed to fetch roadworks:", err));
    }, 500);

    return () => window.clearTimeout(timer);
    // Only re-run when the searched city changes — NOT on every zoom event.
    // isZoomedIn only gates *display* (showRoadworks below), not the fetch.
  }, [focusKey]);

  const isBlockedStreet = (feature?: Feature) => {
    if (!feature || !feature.properties) return false;
    const props = feature.properties;
    const text = (
      (props.id || "") + " " +
      (props.type || "") + " " +
      (props.description || "") + " " +
      (props.text || "") + " " +
      (props.reason || "") + " " +
      (props.constructionReason || "") + " " +
      (props.location || "") + " " +
      (props.place || "")
    ).toLowerCase();
    
    return (
      text.includes("sperr") || 
      text.includes("block") || 
      text.includes("closed") || 
      text.includes("gesperrt")
    );
  };

  const isHeavyTraffic = (feature?: Feature) => {
    if (!feature || !feature.properties) return false;
    const props = feature.properties;
    const text = (
      (props.id || "") + " " +
      (props.type || "") + " " +
      (props.description || "") + " " +
      (props.text || "") + " " +
      (props.reason || "") + " " +
      (props.constructionReason || "") + " " +
      (props.location || "") + " " +
      (props.place || "")
    ).toLowerCase();
    
    return (
      text.includes("stau") ||
      text.includes("delay") ||
      text.includes("congestion") ||
      text.includes("verzöger") ||
      text.includes("zähflüss") ||
      text.includes("überlast")
    );
  };

  const filterFeature = (feature?: Feature) => {
    return isBlockedStreet(feature) || isHeavyTraffic(feature);
  };

  const filterFeatureVector = (feature: Feature) => {
    if (!filterFeature(feature)) return false;
    // Render lines and polygons in GeoJSON. Points are handled as React markers.
    return feature.geometry && feature.geometry.type !== "Point";
  };

  const roadworkStyle = (feature?: Feature) => {
    const blocked = isBlockedStreet(feature);
    return {
      color: blocked ? "#ef4444" : "#f97316", // Red for blocked, Orange for heavy traffic
      weight: blocked ? 5.5 : 3.5, // Thicker red line for blocked streets
      opacity: 0.9,
      dashArray: blocked ? undefined : "6, 6", // Solid for blocked, dashed for traffic
    };
  };

  const getTrafficIcon = (feature: Feature) => {
    const blocked = isBlockedStreet(feature);
    const symbol = blocked ? "⛔" : "⚠️";
    const bgStyle = blocked
      ? "background-color: rgba(239, 68, 68, 0.25); border: 2px solid rgb(239, 68, 68); color: rgb(239, 68, 68);"
      : "background-color: rgba(249, 115, 22, 0.25); border: 2px solid rgb(249, 115, 22); color: rgb(249, 115, 22);";

    return L.divIcon({
      className: "cl-traffic-icon",
      html: `<span class="cl-traffic-inner" style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 9999px; font-size: 12px; font-weight: bold; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.15), 0 2px 4px -1px rgba(0, 0, 0, 0.1); backdrop-filter: blur(2px); transition: transform 0.2s; ${bgStyle}">${symbol}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  };

  const trafficMarkers = useMemo(() => {
    if (!roadworks || !roadworks.features) return [];
    return roadworks.features.filter(filterFeature).map((feature, idx) => {
      const geom = feature.geometry;
      if (!geom) return null;
      let latlng: [number, number] | null = null;
      
      if (geom.type === "Point") {
        latlng = [geom.coordinates[1], geom.coordinates[0]];
      } else if (geom.type === "LineString") {
        const len = geom.coordinates.length;
        if (len > 0) {
          const midIdx = Math.floor(len / 2);
          latlng = [geom.coordinates[midIdx][1], geom.coordinates[midIdx][0]];
        }
      } else if (geom.type === "MultiLineString") {
        const line = geom.coordinates[0];
        if (line && line.length > 0) {
          const midIdx = Math.floor(line.length / 2);
          latlng = [line[midIdx][1], line[midIdx][0]];
        }
      } else if (geom.type === "Polygon") {
        const ring = geom.coordinates[0];
        if (ring && ring.length > 0) {
          const midIdx = Math.floor(ring.length / 2);
          latlng = [ring[midIdx][1], ring[midIdx][0]];
        }
      }
      
      if (!latlng) return null;
      
      return {
        id: feature.properties?.id || `traffic-marker-${idx}`,
        latlng,
        feature,
      };
    }).filter((m): m is NonNullable<typeof m> => m !== null);
  }, [roadworks]);

  const onEachFeature = (feature: Feature, layer: L.Layer) => {
    if (feature.properties) {
      const props = feature.properties;
      const road = props.road || props.roadNumber || props.street || "";
      const loc = props.location || props.place || props.name || "";
      const desc = props.description || props.text || props.reason || props.constructionReason || "";
      const blocked = isBlockedStreet(feature);
      const title = blocked ? "Road Closure (Sperrung)" : "Heavy Traffic (Stau/Verzögerung)";
      layer.bindTooltip(
        `<div class="space-y-1 text-xs min-w-[160px] p-0.5">
          <p class="font-bold ${blocked ? "text-red-500" : "text-orange-500"}">${title}${road ? ` · ${road}` : ""}</p>
          ${loc ? `<p class="text-muted-foreground font-semibold">${loc}</p>` : ""}
          ${desc ? `<p class="text-[10px] text-muted-foreground/80 leading-relaxed border-t border-border/40 pt-1 mt-1">${desc}</p>` : ""}
        </div>`,
        { direction: "top", offset: [0, -6], opacity: 0.95 }
      );
    }
  };

  // Icons keyed by "[eventType-]band-selected". Pin colour tracks confidence
  // (wide variety, slate -> deep red) and an event emoji marks the type.
  const icons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    const emojiKeys = Object.keys(EVENT_EMOJI);
    (Object.keys(BAND_COLORS) as ConfidenceBand[]).forEach((band) => {
      const color = BAND_COLORS[band];
      // fallback (no emoji)
      map.set(`${band}-false`, nodeIcon(color, false));
      map.set(`${band}-true`, nodeIcon(color, true));
      // per-event-type variants
      emojiKeys.forEach((et) => {
        map.set(`${et}-${band}-false`, nodeIcon(color, false, EVENT_EMOJI[et]));
        map.set(`${et}-${band}-true`, nodeIcon(color, true, EVENT_EMOJI[et]));
      });
    });
    return map;
  }, []);

  const lockIcons = useMemo(
    () => ({ idle: lockIcon(false), selected: lockIcon(true) }),
    [],
  );

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

  const showRoadworks = roadworks && isZoomedIn && hasSearched && !!focusKey;

  return (
    <div className={`h-full w-full ${armedTool ? "cl-armed" : ""}`}>
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

      <MapController
        selected={selected}
        focus={focus}
        panTarget={
          selectedMeasure
            ? { id: selectedMeasure.id, position: selectedMeasure.position }
            : null
        }
      />
      <ZoomTracker onZoomChange={setCurrentZoom} />

      {onPlaceMeasure && (
        <PlacementCatcher armed={Boolean(armedTool)} onPlace={onPlaceMeasure} />
      )}

      {/* Tactical measures layer — sits on top of the incident pins. */}
      {measures.map((measure) =>
        measure.kind === "zone" ? (
          <ZoneMeasure
            key={measure.id}
            measure={measure}
            selected={measure.id === selectedMeasureId}
            hovered={measure.id === hoveredMeasureId}
            onSelect={selectMeasure}
            onHover={hoverMeasure}
            onMove={moveMeasure}
            onResize={resizeZone}
          />
        ) : (
          <MeasureMarker
            key={measure.id}
            measure={measure}
            selected={measure.id === selectedMeasureId}
            hovered={measure.id === hoveredMeasureId}
            onSelect={selectMeasure}
            onHover={hoverMeasure}
            onMove={moveMeasure}
          />
        ),
      )}
      {/* MobiData BW Roadworks and Closures Layer */}
      {showRoadworks && (
        <GeoJSON
          key={`traffic-lines-${focusKey}-${roadworks.features.length}-${theme}`}
          data={roadworks}
          filter={filterFeatureVector}
          style={roadworkStyle}
          onEachFeature={onEachFeature}
        />
      )}

      {/* MobiData BW Traffic & Closure Markers */}
      {showRoadworks && trafficMarkers.map((m) => {
        const blocked = isBlockedStreet(m.feature);
        const title = blocked ? "Road Closure (Sperrung)" : "Heavy Traffic (Stau/Verzögerung)";
        const props = (m.feature.properties ?? {}) as Record<string, string | undefined>;
        const road = props.road || props.roadNumber || props.street || "";
        const loc = props.location || props.place || props.name || "";
        const desc = props.description || props.text || props.reason || props.constructionReason || "";

        return (
          <Marker
            key={m.id}
            position={m.latlng}
            icon={getTrafficIcon(m.feature)}
          >
            <Tooltip
              direction="top"
              offset={[0, -6]}
              opacity={0.95}
              className="cl-tooltip"
            >
              <div className="space-y-1 text-xs min-w-[160px] p-0.5">
                <p className={`font-bold ${blocked ? "text-red-500" : "text-orange-500"}`}>
                  {title}{road ? ` · ${road}` : ""}
                </p>
                {loc && <p className="text-muted-foreground font-semibold">{loc}</p>}
                {desc && (
                  <p className="text-[10px] text-muted-foreground/80 leading-relaxed border-t border-border/40 pt-1 mt-1">
                    {desc}
                  </p>
                )}
              </div>
            </Tooltip>
          </Marker>
        );
      })}

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
        return (
          // Key includes selection so the divIcon swaps cleanly.
          <Marker
            key={`${report.id}-${isSelected}`}
            position={report.coordinates}
            icon={
              report.classified
                ? lockIcons[isSelected ? "selected" : "idle"]
                : report.eventType
                  ? icons.get(
                      `${report.eventType}-${confidenceBand(report.confidence)}-${isSelected}`,
                    ) ??
                    icons.get(`${confidenceBand(report.confidence)}-${isSelected}`)
                  : icons.get(`${confidenceBand(report.confidence)}-${isSelected}`)
            }
            opacity={confidenceOpacity(report.confidence)}
            zIndexOffset={isSelected ? 1000 : report.classified ? 500 : 0}
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
                  <span
                    className="font-semibold"
                    style={{ color: confidenceColor(report.confidence) }}
                  >
                    {confidenceLabel(report.confidence)} confidence
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {report.confidence}%
                  </span>
                </p>
                {report.classified && (
                  <p className="flex items-center gap-1.5 pt-0.5 font-semibold text-violet-600 dark:text-violet-400">
                    <Lock className="h-3 w-3 shrink-0" aria-hidden />
                    RESTRICTED · Police Command
                  </p>
                )}
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </MapContainer>
    </div>
  );
}
