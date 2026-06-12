/** Mirrors backend/schemas.py — keep in sync. */

export type Severity = "high" | "moderate" | "low";

export interface SourceReport {
  id: string;
  source: string;
  author: string;
  text: string;
  timestamp: string;
  /** Link to the original post/release (live feeds only). */
  url?: string | null;
  /** Thumbnail of attached media, if any. */
  media_preview?: string | null;
  /** AI analyst's verdict justification (live AI mode). */
  ai_rationale?: string | null;
  /** AI note on whether the media matches the claim (vision mode). */
  ai_media_note?: string | null;
}

export interface VerifiedIncident {
  id: string;
  event_type: string;
  lat: number;
  lon: number;
  confidence_score: number;
  source_ids: string[];
  report_count: number;
  first_seen: string;
  last_seen: string;
  summary: string;
  severity: Severity;
  action_hint: string;
  sources: SourceReport[];
}

export interface DebunkedReport {
  id: string;
  source: string;
  author: string;
  text: string;
  event_type: string;
  lat: number;
  lon: number;
  timestamp: string;
  reason_flagged: string;
  credibility_score: number;
  /** Link to the original post/release (live feeds only). */
  url?: string | null;
  /** AI analyst's justification (live AI mode). */
  rationale?: string | null;
  /** AI note on whether the media matches the claim (vision mode). */
  media_consistency?: string | null;
  /** Thumbnail of the analyzed media, if any. */
  media_preview?: string | null;
}

export interface SubmissionResult {
  verdict: "verified" | "debunked";
  report_id: string;
  message: string;
  incident_id?: string | null;
  confidence_score?: number | null;
  reason_flagged?: string | null;
}

export interface StreamConnection {
  name: string;
  state: string;
  events: number;
  last_event_utc?: string | null;
  detail?: string | null;
}

export interface StreamingInfo {
  enabled: boolean;
  posts_per_min: number;
  queue_depth: number;
  accepted: number;
  filtered: number;
  duplicates: number;
  rate_deferred: number;
  connections: StreamConnection[];
}

export interface SearchScope {
  id: string;
  label: string;
  group: string;
  mode: "radius" | "bbox";
  /** [minLat, minLon, maxLat, maxLon] */
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
}

export interface SearchScopeGroup {
  group: string;
  items: SearchScope[];
}

export interface ScopesResponse {
  active: string;
  scopes: SearchScope[];
  groups?: SearchScopeGroup[];
}

export interface ScopeSwitchResponse {
  status: "ok" | "mock-mode";
  scope: SearchScope;
  stats?: Record<string, number>;
  detail?: string;
}

/** One entry of the real-time "incoming posts" ticker (GET /api/stream/recent). */
export interface StreamPost {
  id: string;
  source: string;
  author: string;
  text: string;
  timestamp: string;
  url?: string | null;
  verdict: "analyzing" | "verified" | "debunked";
  credibility_score?: number | null;
  event_type?: string | null;
  reason?: string | null;
}

export interface HealthInfo {
  status: string;
  incidents: number;
  debunked: number;
  ai_mode: "mock" | "live-ready" | "live";
  /** "live" when real-feed ingestion (FEEDS_ENABLED) is active. */
  data_mode?: "mock" | "live";
  scope?: SearchScope;
  feeds?: { streaming?: StreamingInfo; scope?: SearchScope } & Record<string, unknown>;
}

/** FastAPI backend base URL (override via NEXT_PUBLIC_API_URL). */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
