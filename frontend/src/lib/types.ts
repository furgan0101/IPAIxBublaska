/** Mirrors backend/schemas.py — keep in sync. */

export type Severity = "high" | "moderate" | "low";

export interface SourceReport {
  id: string;
  source: string;
  author: string;
  text: string;
  timestamp: string;
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
}

/** FastAPI backend base URL (override via NEXT_PUBLIC_API_URL). */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
