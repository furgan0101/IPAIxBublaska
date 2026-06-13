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
  /** AI analyst's own 0-1 credibility score (live AI mode only). */
  ai_credibility?: number | null;
}

export interface RelatedIncident {
  incident_id: string;
  relation_type: "causal" | "spatial" | "sequel";
  rationale: string;
}

export interface VerifiedIncident {
  id: string;
  event_type: string;
  lat: number;
  lon: number;
  confidence_score: number;
  ai_credibility?: number | null;
  source_ids: string[];
  report_count: number;
  first_seen: string;
  last_seen: string;
  summary: string;
  severity: Severity;
  action_hint: string;
  sources: SourceReport[];
  related_incidents?: RelatedIncident[];
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

export interface HealthInfo {
  status: string;
  incidents: number;
  debunked: number;
  ai_mode: "mock" | "live-ready" | "live";
  /** "live" when real-feed ingestion (FEEDS_ENABLED) is active. */
  data_mode?: "mock" | "live";
}

export interface DwdStatus {
  active: boolean;
  level: number;
  headline?: string | null;
  description?: string | null;
  timestamp?: string | null;
  url: string;
  temperature?: number | null;
}

export interface PegelStatus {
  active: boolean;
  station?: string | null;
  water?: string | null;
  value?: number | null;
  unit?: string | null;
  timestamp?: string | null;
  state?: string | null;
  url: string;
}

export interface MobiDataStatus {
  active: boolean;
  count: number;
  road?: string | null;
  location?: string | null;
  description?: string | null;
  distance_km?: number | null;
  url: string;
}

/** FastAPI backend base URL (override via NEXT_PUBLIC_API_URL). */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
