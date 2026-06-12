"use client";

import { useEffect } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { confidencePercent } from "@/lib/format";
import { eventMeta } from "@/lib/eventMeta";
import type { DebunkedReport, VerifiedIncident } from "@/lib/types";

// Slightly north of the city centre so the incident cluster frames nicely.
const KONSTANZ_CENTER: [number, number] = [47.663, 9.1755];
const CLUSTER_RADIUS_M = 1_000; // 1.0 km verification radius (metric)

export interface MapFocus {
  lat: number;
  lon: number;
  zoom?: number;
  /** Changes on every focus request so repeated targets still fly. */
  key: string;
}

interface IncidentMapProps {
  incidents: VerifiedIncident[];
  selectedId: string | null;
  hoverId: string | null;
  pulseIds: ReadonlySet<string>;
  flash: DebunkedReport | null;
  focus: MapFocus | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/** Red crisis pin (inline SVG divIcon — no image assets, always renders). */
function crisisPinHtml(size: number, pulse: boolean): string {
  return `
    <span class="pin-wrap" style="width:${size}px;height:${size}px">
      ${pulse ? '<span class="pin-ring"></span>' : ""}
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"
           fill="#ef4444" stroke="#450a0a" stroke-width="0.8">
        <path d="M12 1.8c-4.5 0-8.2 3.7-8.2 8.2 0 5.5 8.2 12.2 8.2 12.2s8.2-6.7 8.2-12.2c0-4.5-3.7-8.2-8.2-8.2z"/>
        <circle cx="12" cy="10" r="3.4" fill="#fef2f2" stroke="none"/>
      </svg>
    </span>`;
}

/** Amber "debunked" pin shown briefly where a hoax claimed to be. */
function debunkedPinHtml(size: number): string {
  return `
    <span class="pin-wrap" style="width:${size}px;height:${size}px">
      <span class="pin-ring pin-ring--amber"></span>
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"
           fill="#f59e0b" stroke="#451a03" stroke-width="0.8">
        <path d="M12 1.8c-4.5 0-8.2 3.7-8.2 8.2 0 5.5 8.2 12.2 8.2 12.2s8.2-6.7 8.2-12.2c0-4.5-3.7-8.2-8.2-8.2z"/>
        <path d="M9.2 7.2 14.8 12.8 M14.8 7.2 9.2 12.8" stroke="#fffbeb" stroke-width="2.2" stroke-linecap="round"/>
      </svg>
    </span>`;
}

function incidentIcon(size: number, pulse: boolean): L.DivIcon {
  return L.divIcon({
    className: "incident-pin",
    html: crisisPinHtml(size, pulse),
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    tooltipAnchor: [0, -size],
  });
}

function debunkedIcon(size: number): L.DivIcon {
  return L.divIcon({
    className: "incident-pin",
    html: debunkedPinHtml(size),
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    tooltipAnchor: [0, -size],
  });
}

/** Imperative bridge: fly the map when the page requests focus. */
function MapController({ focus }: { focus: MapFocus | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const target: [number, number] = [focus.lat, focus.lon];
    const zoom = focus.zoom ?? 15;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      map.setView(target, zoom);
    } else {
      map.flyTo(target, zoom, { duration: 1.1 });
    }
  }, [focus, map]);
  return null;
}

export default function IncidentMap({
  incidents,
  selectedId,
  hoverId,
  pulseIds,
  flash,
  focus,
  onSelect,
  onHover,
}: IncidentMapProps) {
  return (
    <MapContainer
      center={KONSTANZ_CENTER}
      zoom={14}
      zoomControl={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <ZoomControl position="bottomright" />
      <MapController focus={focus} />

      {incidents.map((incident) => {
        const emphasised =
          incident.id === selectedId || incident.id === hoverId;
        return (
          <Circle
            key={`${incident.id}-radius`}
            center={[incident.lat, incident.lon]}
            radius={CLUSTER_RADIUS_M}
            pathOptions={{
              color: "#ef4444",
              weight: emphasised ? 1.5 : 1,
              opacity: emphasised ? 0.6 : 0.3,
              fillColor: "#ef4444",
              fillOpacity: emphasised ? 0.1 : 0.05,
            }}
          />
        );
      })}

      {incidents.map((incident) => {
        const active = incident.id === selectedId || incident.id === hoverId;
        const size = active ? 42 : 34;
        return (
          <Marker
            key={incident.id}
            position={[incident.lat, incident.lon]}
            icon={incidentIcon(size, pulseIds.has(incident.id))}
            eventHandlers={{
              click: () => onSelect(incident.id),
              mouseover: () => onHover(incident.id),
              mouseout: () => onHover(null),
            }}
          >
            <Tooltip direction="top" className="vost-tooltip" opacity={1}>
              <div className="text-[12px]">
                <p className="font-bold text-red-400">
                  {eventMeta(incident.event_type).label} · {incident.id}
                </p>
                <p className="text-slate-300">
                  {confidencePercent(incident.confidence_score)} confidence ·{" "}
                  {incident.report_count} source
                  {incident.report_count === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Click for dossier & action
                </p>
              </div>
            </Tooltip>
          </Marker>
        );
      })}

      {flash && (
        <Marker
          position={[flash.lat, flash.lon]}
          icon={debunkedIcon(38)}
          interactive={false}
        >
          <Tooltip
            direction="top"
            className="vost-tooltip"
            opacity={1}
            permanent
          >
            <div className="text-[12px]">
              <p className="font-bold text-amber-400">DEBUNKED</p>
              <p className="max-w-[220px] text-slate-300">
                {flash.reason_flagged}
              </p>
            </div>
          </Tooltip>
        </Marker>
      )}
    </MapContainer>
  );
}
