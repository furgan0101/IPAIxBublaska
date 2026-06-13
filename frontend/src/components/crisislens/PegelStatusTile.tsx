"use client";

import { useEffect, useState } from "react";
import { Waves, ExternalLink } from "lucide-react";
import { API_BASE, type PegelStatus } from "@/lib/types";

interface PegelStatusTileProps {
  locationName?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export default function PegelStatusTile({ locationName, lat, lon }: PegelStatusTileProps) {
  const [status, setStatus] = useState<PegelStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const params = new URLSearchParams();
        if (locationName) params.append("q", locationName);
        if (lat !== undefined && lat !== null) params.append("lat", lat.toString());
        if (lon !== undefined && lon !== null) params.append("lon", lon.toString());

        const queryString = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/api/pegel/status${queryString}`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch Pegel status:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, 15000);
    return () => clearInterval(timer);
  }, [locationName, lat, lon]);

  const getStateColor = (state: string | null | undefined) => {
    if (!state) return "bg-blue-500/10 text-blue-600 border-blue-500/20 opacity-40";
    if (state.toLowerCase() === "hochwasser") return "bg-red-500 text-white border-red-600";
    if (state.toLowerCase() === "niedrigwasser") return "bg-amber-400 text-black border-amber-500";
    return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  };

  const active = status?.active ?? false;
  const value = status?.value;
  const unit = status?.unit ?? "cm";
  const state = status?.state ?? "Normal";
  const station = status?.station;
  const water = status?.water;
  const url = status?.url || "https://www.hvz.baden-wuerttemberg.de";

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card/50 px-3 py-1.5 transition-all hover:bg-muted"
      title={active ? `Pegel ${station} (${water}): ${value} ${unit} - State: ${state}\nClick for details` : "No water level data"}
    >
      <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${getStateColor(active ? state : null)}`}>
        <Waves className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
      </div>
      <div className="hidden sm:block">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {active && station ? `${station} (${water || "Pegel"})` : "Pegelstand"}
          </span>
          {active && state.toLowerCase() === "hochwasser" && (
             <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          )}
        </div>
        <div className="text-[11px] font-semibold leading-tight text-foreground">
          {active && value !== undefined && value !== null ? (
            <span className="flex items-center gap-1">
              {value} {unit} · {state}
              <ExternalLink className="h-2.5 w-2.5 opacity-50" />
            </span>
          ) : (
            <span className="opacity-50">No Data</span>
          )}
        </div>
      </div>
    </a>
  );
}
