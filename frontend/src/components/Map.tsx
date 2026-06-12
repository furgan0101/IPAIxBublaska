"use client";

import { useEffect, useState } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { API_BASE, type VerifiedIncident } from "@/lib/types";
import { confidencePercent, timeAgo, titleCase } from "@/lib/format";

const KONSTANZ_CENTER: [number, number] = [47.6603, 9.1758];
const REFRESH_INTERVAL_MS = 10_000;
const CLUSTER_RADIUS_M = 1_000; // 1.0 km verification radius (metric)

// Red incident pin as an inline SVG divIcon — no image assets, no bundler
// icon-path issues, always renders.
const incidentIcon = L.divIcon({
  className: "incident-pin",
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24"
         fill="#ef4444" stroke="#450a0a" stroke-width="0.8">
      <path d="M12 1.8c-4.5 0-8.2 3.7-8.2 8.2 0 5.5 8.2 12.2 8.2 12.2s8.2-6.7 8.2-12.2c0-4.5-3.7-8.2-8.2-8.2z"/>
      <circle cx="12" cy="10" r="3.4" fill="#fef2f2" stroke="none"/>
    </svg>`,
  iconSize: [34, 34],
  iconAnchor: [17, 32],
  popupAnchor: [0, -30],
});

export default function IncidentMap() {
  const [incidents, setIncidents] = useState<VerifiedIncident[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch(`${API_BASE}/api/incidents`);
        if (!res.ok) return;
        const data: VerifiedIncident[] = await res.json();
        if (!cancelled) setIncidents(data);
      } catch {
        // Backend not up yet — keep polling silently.
      }
    }

    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <MapContainer center={KONSTANZ_CENTER} zoom={14} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {incidents.map((incident) => (
        <Circle
          key={`${incident.id}-radius`}
          center={[incident.lat, incident.lon]}
          radius={CLUSTER_RADIUS_M}
          pathOptions={{
            color: "#ef4444",
            weight: 1,
            opacity: 0.35,
            fillColor: "#ef4444",
            fillOpacity: 0.06,
          }}
        />
      ))}

      {incidents.map((incident) => (
        <Marker
          key={incident.id}
          position={[incident.lat, incident.lon]}
          icon={incidentIcon}
        >
          <Popup>
            <div className="min-w-[220px] space-y-1.5 text-[13px]">
              <p className="font-bold tracking-wide text-red-400">
                {titleCase(incident.event_type)} · {incident.id}
              </p>
              <p className="text-slate-300">{incident.summary}</p>
              <p className="text-slate-400">
                Confidence{" "}
                <span className="font-semibold text-emerald-400">
                  {confidencePercent(incident.confidence_score)}
                </span>{" "}
                · {incident.report_count} source
                {incident.report_count === 1 ? "" : "s"}
              </p>
              <p className="text-slate-400">
                Last report {timeAgo(incident.last_seen)}
              </p>
              <p className="font-mono text-[11px] text-slate-500">
                {incident.source_ids.join(" · ")}
              </p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
