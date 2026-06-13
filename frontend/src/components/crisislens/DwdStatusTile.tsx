"use client";

import { useEffect, useState } from "react";
import { CloudLightning, ExternalLink } from "lucide-react";
import { API_BASE, type DwdStatus } from "@/lib/types";

export default function DwdStatusTile() {
  const [status, setStatus] = useState<DwdStatus | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dwd/status`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch DWD status:", err);
      }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, []);

  if (!status) return null;

  const getLevelColor = (level: number) => {
    if (level >= 3) return "bg-red-500 text-white border-red-600";
    if (level === 2) return "bg-orange-500 text-white border-orange-600";
    if (level === 1) return "bg-amber-400 text-black border-amber-500";
    return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  };

  return (
    <a
      href={status.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-lg border border-border bg-card/50 px-3 py-1.5 transition-all hover:bg-muted"
      title={status.active ? `${status.headline}\nClick for details` : "No active weather warnings"}
    >
      <div className={`flex h-7 w-7 items-center justify-center rounded-md border ${getLevelColor(status.level)}`}>
        <CloudLightning className="h-4 w-4" />
      </div>
      <div className="hidden sm:block">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            DWD Status
          </span>
          {status.active && (
             <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          )}
        </div>
        <div className="text-[11px] font-semibold leading-tight text-foreground">
          {status.active ? (
            <span className="flex items-center gap-1">
              Level {status.level} Warning
              <ExternalLink className="h-2.5 w-2.5 opacity-50" />
            </span>
          ) : (
            "No Warnings"
          )}
        </div>
      </div>
    </a>
  );
}
