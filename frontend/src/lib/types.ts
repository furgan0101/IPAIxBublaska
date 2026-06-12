/** Mirrors backend/schemas.py — keep in sync. */

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

/** FastAPI backend base URL (override via NEXT_PUBLIC_API_URL). */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
