"use client";

import { useCallback, useState } from "react";

import Landing from "@/components/crisislens/Landing";
import Dashboard from "@/components/crisislens/Dashboard";

/**
 * Cross-fade between the hero and the dashboard: during "exiting" both are
 * mounted — the dashboard fades in underneath while the hero dissolves.
 */
type Phase = "landing" | "exiting" | "dashboard";

const EXIT_DURATION_MS = 700;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");

  const begin = useCallback(() => {
    setPhase("exiting");
    window.setTimeout(() => setPhase("dashboard"), EXIT_DURATION_MS);
  }, []);

  return (
    <div className="relative h-screen overflow-hidden bg-night-950">
      {phase !== "landing" && <Dashboard />}
      {phase !== "dashboard" && (
        <Landing exiting={phase === "exiting"} onBegin={begin} />
      )}
    </div>
  );
}
