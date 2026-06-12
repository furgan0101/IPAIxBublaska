"use client";

import dynamic from "next/dynamic";
import { Radar } from "lucide-react";

import Sidebar from "@/components/Sidebar";

// Leaflet touches `window` — load the map strictly client-side.
const IncidentMap = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm text-slate-500">
      Initialising tactical map…
    </div>
  ),
});

export default function Home() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-5 py-3">
        <Radar className="h-6 w-6 shrink-0 text-red-500" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold tracking-widest">
            VOST<span className="text-red-500">BW</span> · OSINT SITUATIONAL
            AWARENESS
          </h1>
          <p className="truncate text-[11px] uppercase tracking-wider text-slate-500">
            Sector Konstanz · 47.6603 N, 9.1758 E · verification radius 1.0 km
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[11px] font-semibold tracking-widest text-red-400">
            LIVE
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <IncidentMap />
        </main>
        <Sidebar />
      </div>
    </div>
  );
}
