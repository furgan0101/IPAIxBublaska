"use client";

import { useEffect, useState } from "react";
import { Car, ExternalLink } from "lucide-react";
import { API_BASE, type MobiDataStatus } from "@/lib/types";

interface MobiDataStatusTileProps {
  locationName?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export default function MobiDataStatusTile({ locationName, lat, lon }: MobiDataStatusTileProps) {
  const [status, setStatus] = useState<MobiDataStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const params = new URLSearchParams();
        if (locationName) params.append("q", locationName);
        if (lat !== undefined && lat !== null) params.append("lat", lat.toString());
        if (lon !== undefined && lon !== null) params.append("lon", lon.toString());

        const queryString = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/api/mobidata/status${queryString}`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch MobiData status:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, 20000); // 20 s cache poll
    return () => clearInterval(timer);
  }, [locationName, lat, lon]);

  const active = status?.active ?? false;
  const count = status?.count ?? 0;
  const road = status?.road;
  const location = status?.location;
  const description = status?.description;
  const distance = status?.distance_km;
  const url = status?.url || "https://www.verkehrsinfo-bw.de";

  const getStatusColor = () => {
    if (!active || count === 0) {
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 opacity-40";
    }
    if (count > 5) {
      return "bg-red-500 text-white border-red-600";
    }
    return "bg-amber-400 text-black border-amber-500";
  };

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card/50 px-3 py-1.5 transition-all hover:bg-muted"
      title={active && count > 0 ? `MobiData BW: ${count} nearby warnings\nClosest: ${road} - ${location}\n${description}\nClick for traffic map` : "No traffic warnings"}
    >
      <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${getStatusColor()}`}>
        <Car className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
      </div>
      <div className="hidden sm:block">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {active && count > 0 && road ? `Traffic · ${road}` : "MobiData BW"}
          </span>
          {active && count > 0 && (
             <span className="flex h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          )}
        </div>
        <div className="text-[11px] font-semibold leading-tight text-foreground">
          {active && count > 0 ? (
            <span className="flex items-center gap-1">
              {count} Warnings ({distance}km)
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
