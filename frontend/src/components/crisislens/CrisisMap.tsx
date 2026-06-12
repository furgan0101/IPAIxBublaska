"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { STATUS_META, type CrisisReport } from "@/lib/mockReports";

/** Overview framing for the Baden-Württemberg sector. */
const BW_CENTER: [number, number] = [48.62, 9.05];
const BW_ZOOM = 8;
const FOCUS_ZOOM = 9;

/** Wait for the detail-panel width transition (500 ms) before flying. */
const FLY_DELAY_MS = 560;

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

/**
 * Keeps Leaflet in sync with the surrounding layout: re-measures while the
 * detail panel resizes the map column, and flies to / away from the
 * selected report.
 */
function MapController({ selected }: { selected: CrisisReport | null }) {
  const map = useMap();
  const firstRun = useRef(true);

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
      } else {
        map.flyTo(BW_CENTER, BW_ZOOM, { duration: 0.9 });
      }
    }, FLY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [map, selected]);

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
}

export default function CrisisMap({
  reports,
  selectedId,
  onSelect,
  theme,
}: CrisisMapProps) {
  const selected = reports.find((r) => r.id === selectedId) ?? null;

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

  return (
    <MapContainer
      center={BW_CENTER}
      zoom={BW_ZOOM}
      className="h-full w-full"
      zoomControl
    >
      <TileLayer
        key={theme}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={TILE_URLS[theme]}
      />

      <MapController selected={selected} />

      {reports.map((report) => {
        const isSelected = report.id === selectedId;
        const meta = STATUS_META[report.status];
        return (
          // Key includes selection so the divIcon swaps cleanly.
          <Marker
            key={`${report.id}-${isSelected}`}
            position={report.coordinates}
            icon={icons.get(`${report.status}-${isSelected}`)}
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
    </MapContainer>
  );
}
