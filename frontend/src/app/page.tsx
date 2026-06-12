"use client";

import { useCallback, useEffect, useState } from "react";

import Landing from "@/components/crisislens/Landing";
import Dashboard from "@/components/crisislens/Dashboard";

/**
 * Cross-fade between the hero and the dashboard: during "exiting" both are
 * mounted — the dashboard fades in underneath while the hero dissolves.
 */
type Phase = "landing" | "exiting" | "dashboard";
export type Theme = "dark" | "light";

const EXIT_DURATION_MS = 700;
const THEME_KEY = "crisislens-theme";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [theme, setTheme] = useState<Theme>("dark");

  // The pre-paint script in layout.tsx has already set the class; sync state.
  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
    // Deep link straight into the dashboard (demos, kiosk mode, screenshots).
    if (new URLSearchParams(window.location.search).has("dashboard")) {
      setPhase("dashboard");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Storage unavailable — theme still applies for this session.
      }
      return next;
    });
  }, []);

  const begin = useCallback(() => {
    setPhase("exiting");
    window.setTimeout(() => setPhase("dashboard"), EXIT_DURATION_MS);
  }, []);

  return (
    <div className="relative h-screen overflow-hidden bg-background">
      {phase !== "landing" && (
        <Dashboard theme={theme} onToggleTheme={toggleTheme} />
      )}
      {phase !== "dashboard" && (
        <Landing
          exiting={phase === "exiting"}
          onBegin={begin}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}
    </div>
  );
}
