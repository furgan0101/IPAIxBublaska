"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  API_BASE,
  type DebunkedReport,
  type HealthInfo,
  type VerifiedIncident,
} from "@/lib/types";

const REFRESH_INTERVAL_MS = 5_000;
const PULSE_DURATION_MS = 5_000;

export interface DashboardSnapshot {
  incidents: VerifiedIncident[];
  debunked: DebunkedReport[];
}

export interface DashboardData {
  incidents: VerifiedIncident[] | null;
  debunked: DebunkedReport[] | null;
  health: HealthInfo | null;
  online: boolean;
  /** Incident ids that appeared since the previous poll — pulse them on the map. */
  pulseIds: ReadonlySet<string>;
  refresh: () => Promise<DashboardSnapshot | null>;
}

/** Single data loop for the whole dashboard: poll + on-demand refresh. */
export function useDashboard(): DashboardData {
  const [incidents, setIncidents] = useState<VerifiedIncident[] | null>(null);
  const [debunked, setDebunked] = useState<DebunkedReport[] | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [online, setOnline] = useState(true);
  const [pulseIds, setPulseIds] = useState<ReadonlySet<string>>(new Set());
  const knownIds = useRef<Set<string> | null>(null);

  const refresh = useCallback(async (): Promise<DashboardSnapshot | null> => {
    try {
      const [incidentsRes, debunkedRes, healthRes] = await Promise.all([
        fetch(`${API_BASE}/api/incidents`),
        fetch(`${API_BASE}/api/debunked`),
        fetch(`${API_BASE}/api/health`),
      ]);
      if (!incidentsRes.ok || !debunkedRes.ok || !healthRes.ok) {
        throw new Error("bad status");
      }
      const nextIncidents = (await incidentsRes.json()) as VerifiedIncident[];
      const nextDebunked = (await debunkedRes.json()) as DebunkedReport[];
      const nextHealth = (await healthRes.json()) as HealthInfo;

      // Pulse incidents that are new relative to the previous poll (skip first load).
      const known = knownIds.current;
      if (known !== null) {
        const fresh = nextIncidents
          .filter((incident) => !known.has(incident.id))
          .map((incident) => incident.id);
        if (fresh.length > 0) {
          setPulseIds((prev) => new Set([...prev, ...fresh]));
          window.setTimeout(() => {
            setPulseIds((prev) => {
              const next = new Set(prev);
              fresh.forEach((id) => next.delete(id));
              return next;
            });
          }, PULSE_DURATION_MS);
        }
      }
      knownIds.current = new Set(nextIncidents.map((incident) => incident.id));

      setIncidents(nextIncidents);
      setDebunked(nextDebunked);
      setHealth(nextHealth);
      setOnline(true);
      return { incidents: nextIncidents, debunked: nextDebunked };
    } catch {
      setOnline(false);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { incidents, debunked, health, online, pulseIds, refresh };
}
