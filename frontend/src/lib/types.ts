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
  /** AI analyst's per-source plausibility score, 0–1 (live AI mode only; null otherwise). */
  ai_credibility?: number | null;
}

export interface SOPTask {
  task: string;
  agency: string;
  completed: boolean;
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
  /** True once the incident was handed to the Leitstelle (manual or auto). */
  dispatched: boolean;
  /** ISO timestamp of the handoff. */
  dispatched_at?: string | null;
  /** Security-sensitive incident — information discipline applies. */
  classified: boolean;
  /** Itemized SOP checklist for responders. */
  sop_tasks: SOPTask[];
  sources: SourceReport[];
  /** Mean AI plausibility across clustered sources, 0–1. Null in mock/heuristic mode. */
  ai_credibility?: number | null;
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

/** FastAPI backend base URL (override via NEXT_PUBLIC_API_URL). */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
