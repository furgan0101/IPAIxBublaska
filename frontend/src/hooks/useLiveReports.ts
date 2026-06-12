"use client";

import { useEffect, useRef, useState } from "react";

import {
  API_BASE,
  type DebunkedReport,
  type HealthInfo,
  type VerifiedIncident,
} from "@/lib/types";
import { MOCK_REPORTS, type CrisisReport } from "@/lib/mockReports";
import { toReports } from "@/lib/liveAdapter";

const REFRESH_INTERVAL_MS = 5_000;

export type DataMode = "live" | "backend-demo" | "offline-demo" | "connecting";

export interface LiveReportsState {
  reports: CrisisReport[];
  /** Where `reports` came from — drives the LIVE / DEMO indicator. */
  mode: DataMode;
  /** Backend reachable on the last poll. */
  online: boolean;
  /** Backend AI analyst state, when known. */
  aiMode: HealthInfo["ai_mode"] | null;
  lastUpdated: Date | null;
}

/**
 * Single polling loop for the CrisisLens dashboard.
 *
 * Source of truth is the FastAPI backend (real OSINT feeds + AI filter when
 * FEEDS_ENABLED / USE_LIVE_AI are on). If the backend is unreachable we fall
 * back to the bundled synthetic dataset so the demo never shows a blank
 * screen — and the returned `mode` makes that fallback explicit in the UI.
 */
export function useLiveReports(): LiveReportsState {
  const [state, setState] = useState<LiveReportsState>({
    reports: MOCK_REPORTS,
    mode: "connecting",
    online: false,
    aiMode: null,
    lastUpdated: null,
  });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    async function poll(): Promise<void> {
      try {
        const [incRes, debRes, healthRes] = await Promise.all([
          fetch(`${API_BASE}/api/incidents`),
          fetch(`${API_BASE}/api/debunked`),
          fetch(`${API_BASE}/api/health`),
        ]);
        if (!incRes.ok || !debRes.ok || !healthRes.ok) {
          throw new Error("bad status");
        }
        const incidents = (await incRes.json()) as VerifiedIncident[];
        const debunked = (await debRes.json()) as DebunkedReport[];
        const health = (await healthRes.json()) as HealthInfo;

        const live = health.data_mode === "live";
        const liveReports = toReports(incidents, debunked);

        // Live + at least one signal → show it. Live but momentarily empty
        // (feeds quiet), or backend serving its own mock feed → show the
        // bundled dataset, badged "Demo feed" (backend is up, just no live
        // signals right now — not an offline state).
        if (cancelled.current) return;
        setState({
          reports: liveReports.length > 0 ? liveReports : MOCK_REPORTS,
          mode: live && liveReports.length > 0 ? "live" : "backend-demo",
          online: true,
          aiMode: health.ai_mode,
          lastUpdated: new Date(),
        });
      } catch {
        if (cancelled.current) return;
        setState((prev) => ({
          reports: MOCK_REPORTS,
          mode: "offline-demo",
          online: false,
          aiMode: prev.aiMode,
          lastUpdated: prev.lastUpdated,
        }));
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
