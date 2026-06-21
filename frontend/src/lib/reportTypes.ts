/**
 * CrisisLens view-model contract.
 *
 * The dashboard, map and dossier all speak `CrisisReport`. Real backend data
 * (`VerifiedIncident` / `DebunkedReport`) is translated into this shape by
 * `liveAdapter.ts` — this module holds only the types and presentation
 * constants, no data. There is no synthetic feed.
 */

import type { SOPTask } from "@/lib/types";

export type ReportStatus = "relevant" | "review" | "ignored";
export type RiskLevel = "High" | "Moderate" | "Low";
export type Credibility = "high" | "medium" | "low";
export type SourceType =
  | "Local News"
  | "Social Media"
  | "Forum"
  | "Weather Alert"
  | "Citizen Report";

export interface EvidenceLink {
  sourceType: SourceType;
  title: string;
  /** ISO timestamp. */
  time: string;
  credibility: Credibility;
  href: string;
  /** Thumbnail of the source's attached media. */
  mediaPreview?: string | null;
}

export interface ConfidenceBreakdown {
  sourceReliability: number;
  locationMatch: number;
  mediaSupport: number;
  crossSourceConfirmation: number;
}

export interface CrisisReport {
  id: string;
  title: string;
  crisisType: string;
  city: string;
  /** [lat, lon] — WGS84. */
  coordinates: [number, number];
  status: ReportStatus;
  /** AI-assisted plausibility estimate, 0–100. */
  confidence: number;
  riskLevel: RiskLevel;
  /** ISO timestamp of the most recent signal. */
  timestamp: string;
  aiSummary: string;
  /** 0–100. */
  locationConfidence: number;
  reasonForDecision: string;
  breakdown: ConfidenceBreakdown;
  evidenceLinks: EvidenceLink[];
  /** Raw intercepted snippet shown in the Latest Signals feed. */
  signalSnippet: string;
  /** Attribution line for the snippet. */
  signalSource: string;
  /** Thumbnails of the media the AI analyzed. */
  mediaPreviews?: string[];
  /** AI note on whether the media matches the claim. */
  mediaConsistency?: string | null;
  /** Link to the original post/release. */
  externalUrl?: string | null;
  /** Recommended responder action (narrative hint, own dossier block). */
  actionHint?: string | null;
  /** Itemized SOP checklist — presence marks the report as dispatchable. */
  sopTasks?: SOPTask[];
  /** True once the incident was handed to the Leitstelle (manual or auto). */
  dispatched?: boolean;
  /** ISO timestamp of the Leitstelle handoff. */
  dispatchedAt?: string | null;
  /** Information discipline: raw intel (media, sources, snippets) is masked. */
  classified?: boolean;
}

export const STATUS_META: Record<
  ReportStatus,
  {
    label: string;
    badge: string;
    /** Hex used for map nodes / ring gauges (works on both basemaps). */
    color: string;
    chip: string;
    dot: string;
    text: string;
  }
> = {
  relevant: {
    label: "Escalated",
    badge: "Escalated · evidence-based",
    color: "#dc2626",
    chip: "border-red-600/25 bg-red-600/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    dot: "bg-red-600 dark:bg-red-500",
    text: "text-red-700 dark:text-red-400",
  },
  review: {
    label: "Needs review",
    badge: "Human review required",
    color: "#ea580c",
    chip: "border-orange-600/25 bg-orange-600/10 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
    dot: "bg-orange-600 dark:bg-orange-500",
    text: "text-orange-700 dark:text-orange-400",
  },
  ignored: {
    label: "Ignored",
    badge: "Ignored · insufficient corroboration",
    color: "#eab308",
    chip: "border-yellow-600/30 bg-yellow-500/10 text-yellow-700 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300",
    dot: "bg-yellow-500",
    text: "text-yellow-700 dark:text-yellow-400",
  },
};
