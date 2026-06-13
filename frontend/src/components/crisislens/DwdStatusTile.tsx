"use client";

import { useEffect, useState } from "react";
import { CloudLightning, ExternalLink } from "lucide-react";
import { API_BASE, type DwdStatus } from "@/lib/types";

interface DwdStatusTileProps {
  locationName?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export default function DwdStatusTile({ locationName, lat, lon }: DwdStatusTileProps) {
  const [status, setStatus] = useState<DwdStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const params = new URLSearchParams();
        if (locationName) params.append("q", locationName);
        if (lat !== undefined && lat !== null) params.append("lat", lat.toString());
        if (lon !== undefined && lon !== null) params.append("lon", lon.toString());

        const queryString = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/api/dwd/status${queryString}`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch DWD status:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, [locationName, lat, lon]);

  const getLevelColor = (level: number) => {
    if (level >= 3) return "bg-red-500 text-white border-red-600";
    if (level === 2) return "bg-orange-500 text-white border-orange-600";
    if (level === 1) return "bg-amber-400 text-black border-amber-500";
    return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 opacity-40";
  };

  const active = status?.active ?? false;
  const level = status?.level ?? 0;
  const url = status?.url || `https://www.dwd.de/DE/wetter/warnungen_gemeinden/warnWetter_node.html?ort=${encodeURIComponent(locationName || "Mannheim")}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card/50 px-3 py-1.5 transition-all hover:bg-muted"
      title={active ? `${status?.headline}\nClick for details` : "No active weather warnings"}
    >
      <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${getLevelColor(level)}`}>
        <CloudLightning className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
      </div>
      <div className="hidden sm:block">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            DWD Status{status?.temperature !== undefined && status?.temperature !== null ? ` · ${status.temperature}°C` : ""}
          </span>
          {active && (
             <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          )}
        </div>
        <div className="text-[11px] font-semibold leading-tight text-foreground">
          {active ? (
            <span className="flex items-center gap-1">
              Level {level} Warning
              <ExternalLink className="h-2.5 w-2.5 opacity-50" />
            </span>
          ) : (
            <span className="opacity-50">No Warnings</span>
          )}
        </div>
      </div>
    </a>
  );
}
