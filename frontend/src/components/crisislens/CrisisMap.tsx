"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Lock } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import "leaflet/dist/leaflet.css";

import { STATUS_META, type CrisisReport } from "@/lib/mockReports";
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

/** Overview framing for the Baden-Württemberg sector. */
const BW_CENTER: [number, number] = [48.62, 9.05];
const BW_ZOOM = 8;
const FOCUS_ZOOM = 9;

/** Wait for the detail-panel width transition (500 ms) before flying. */
const FLY_DELAY_MS = 560;

/** Command Mode focus target — the map flies to the city in command. */
export interface MapFocus {
  center: [number, number];
  zoom: number;
}

function nodeIcon(color: string, selected: boolean): L.DivIcon {
  const size = selected ? 30 : 22;
  return L.divIcon({
    className: "cl-node-wrap",
    html: `<span class="cl-node${selected ? " cl-node--selected" : ""}" style="--node:${color}"><span class="cl-node-ring"></span><span class="cl-node-core"></span></span>`,
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

  // Six icons total (3 statuses × selected/unselected) — build once.
  const icons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    (Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).forEach(
      (status) => {
        map.set(`${status}-false`, nodeIcon(STATUS_META[status].color, false));
        map.set(`${status}-true`, nodeIcon(STATUS_META[status].color, true));
      },
    );
    return map;
  }, []);

  const lockIcons = useMemo(
    () => ({ idle: lockIcon(false), selected: lockIcon(true) }),
    [],
  );

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

      {reports.map((report) => {
        const isSelected = report.id === selectedId;
        const meta = STATUS_META[report.status];
        return (
          // Key includes selection so the divIcon swaps cleanly.
          <Marker
            key={`${report.id}-${isSelected}`}
            position={report.coordinates}
            icon={
              report.classified
                ? lockIcons[isSelected ? "selected" : "idle"]
                : icons.get(`${report.status}-${isSelected}`)
            }
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
                  <span className={`font-semibold ${meta.text}`}>
                    {meta.label}
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
