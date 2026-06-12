"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  API_BASE,
  type DebunkedReport,
  type HealthInfo,
  type ScopesResponse,
  type ScopeSwitchResponse,
  type SearchScope,
  type SearchScopeGroup,
  type StreamPost,
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
  scopes: SearchScope[] | null;
  scopeGroups: SearchScopeGroup[] | null;
  activeScope: SearchScope | null;
  scopePending: boolean;
  scopeError: string | null;
  /** Real-time ticker entries (empty unless FEEDS_STREAMING is on). */
  streamPosts: StreamPost[] | null;
  online: boolean;
  /** Incident ids that appeared since the previous poll — pulse them on the map. */
  pulseIds: ReadonlySet<string>;
  refresh: () => Promise<DashboardSnapshot | null>;
  changeScope: (id: string) => Promise<void>;
}

function groupScopes(scopes: SearchScope[]): SearchScopeGroup[] {
  const groups = new Map<string, SearchScope[]>();
  for (const scope of scopes) {
    const items = groups.get(scope.group) ?? [];
    items.push(scope);
    groups.set(scope.group, items);
  }
  return Array.from(groups, ([group, items]) => ({ group, items }));
}

/** Single data loop for the whole dashboard: poll + on-demand refresh. */
export function useDashboard(): DashboardData {
  const [incidents, setIncidents] = useState<VerifiedIncident[] | null>(null);
  const [debunked, setDebunked] = useState<DebunkedReport[] | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [scopes, setScopes] = useState<SearchScope[] | null>(null);
  const [scopeGroups, setScopeGroups] = useState<SearchScopeGroup[] | null>(null);
  const [activeScope, setActiveScope] = useState<SearchScope | null>(null);
  const [scopePending, setScopePending] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [streamPosts, setStreamPosts] = useState<StreamPost[] | null>(null);
  const [online, setOnline] = useState(true);
  const [pulseIds, setPulseIds] = useState<ReadonlySet<string>>(new Set());
  const knownIds = useRef<Set<string> | null>(null);

  const refresh = useCallback(async (): Promise<DashboardSnapshot | null> => {
    try {
      const [incidentsRes, debunkedRes, healthRes, streamRes, scopesRes] = await Promise.all([
        fetch(`${API_BASE}/api/incidents`),
        fetch(`${API_BASE}/api/debunked`),
        fetch(`${API_BASE}/api/health`),
        fetch(`${API_BASE}/api/stream/recent`),
        fetch(`${API_BASE}/api/scopes`),
      ]);
      if (
        !incidentsRes.ok ||
        !debunkedRes.ok ||
        !healthRes.ok ||
        !streamRes.ok ||
        !scopesRes.ok
      ) {
        throw new Error("bad status");
      }
      const nextIncidents = (await incidentsRes.json()) as VerifiedIncident[];
      const nextDebunked = (await debunkedRes.json()) as DebunkedReport[];
      const nextHealth = (await healthRes.json()) as HealthInfo;
      const nextStream = (await streamRes.json()) as StreamPost[];
      const nextScopes = (await scopesRes.json()) as ScopesResponse;

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
      setStreamPosts(nextStream);
      setScopes(nextScopes.scopes);
      setScopeGroups(nextScopes.groups ?? groupScopes(nextScopes.scopes));
      setActiveScope(
        nextScopes.scopes.find((scope) => scope.id === nextScopes.active) ??
          nextHealth.scope ??
          null,
      );
      setOnline(true);
      return { incidents: nextIncidents, debunked: nextDebunked };
    } catch {
      setOnline(false);
      return null;
    }
  }, []);

  const changeScope = useCallback(
    async (id: string): Promise<void> => {
      setScopePending(true);
      setScopeError(null);
      try {
        const response = await fetch(`${API_BASE}/api/scope`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as ScopeSwitchResponse;
        setActiveScope(payload.scope);
        setIncidents([]);
        setDebunked([]);
        setStreamPosts([]);
        knownIds.current = null;
        await refresh();
      } catch (error) {
        setScopeError(error instanceof Error ? error.message : "Scope switch failed");
        throw error;
      } finally {
        setScopePending(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return {
    incidents,
    debunked,
    health,
    scopes,
    scopeGroups,
    activeScope,
    scopePending,
    scopeError,
    streamPosts,
    online,
    pulseIds,
    refresh,
    changeScope,
  };
}
