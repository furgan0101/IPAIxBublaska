/**
 * Adapter: backend pipeline output -> the CrisisLens UI contract.
 *
 * The backend serves `VerifiedIncident` (geo-clustered, credible) and
 * `DebunkedReport` (rejected by the credibility filter). The dashboard,
 * map and dossier all speak `CrisisReport`. This module is the single
 * translation layer, so the visual components never change shape when the
 * data goes from static mock to live backend.
 */

import { safeNewDate } from "@/lib/format";
import { getWorkingUrl } from "@/lib/urls";
import {
  type CrisisReport,
  type Credibility,
  type EvidenceLink,
  type ReportStatus,
  type RiskLevel,
  type SourceType,
} from "@/lib/mockReports";
import { eventMeta } from "@/lib/eventMeta";
import type {
  DebunkedReport,
  Severity,
  SourceReport,
  VerifiedIncident,
} from "@/lib/types";

/** Coarse nearest-city label for the BW demo sector (display only). */
const BW_CITIES: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  { name: "Konstanz", lat: 47.6603, lon: 9.1758 },
  { name: "Stuttgart", lat: 48.7758, lon: 9.1829 },
  { name: "Karlsruhe", lat: 49.0069, lon: 8.4037 },
  { name: "Freiburg", lat: 47.999, lon: 7.8421 },
  { name: "Mannheim", lat: 49.4875, lon: 8.466 },
  { name: "Ulm", lat: 48.4011, lon: 9.9876 },
  { name: "Heidelberg", lat: 49.3988, lon: 8.6724 },
  { name: "Heilbronn", lat: 49.1427, lon: 9.2109 },
];

function nearestCity(lat: number, lon: number): string {
  let best = BW_CITIES[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of BW_CITIES) {
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.name;
}

/** Map a backend source channel to one of the UI's evidence source types. */
function sourceType(source: string): SourceType {
  const s = source.toLowerCase();
  if (s.includes("nina") || s.includes("dwd") || s.includes("warn"))
    return "Weather Alert";
  if (s.includes("presse") || s.includes("news") || s.includes("swr"))
    return "Local News";
  if (s.includes("forum")) return "Forum";
  if (
    s.includes("twitter") ||
    s.includes("mastodon") ||
    s.includes("telegram") ||
    s.includes("x")
  )
    return "Social Media";
  return "Citizen Report";
}

const RISK_BY_SEVERITY: Record<Severity, RiskLevel> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

function credibilityBand(score01: number): Credibility {
  if (score01 >= 0.75) return "high";
  if (score01 >= 0.45) return "medium";
  return "low";
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function evidenceFromSource(s: SourceReport): EvidenceLink {
  return {
    sourceType: sourceType(s.source),
    title: `${s.author}: ${s.text}`.slice(0, 120),
    time: s.timestamp,
    credibility: "medium",
    href: getWorkingUrl(s.url, s.text, s.source, s.author),
  };
}

/** A credible, clustered incident -> escalated/review CrisisReport. */
export function incidentToReport(inc: VerifiedIncident): CrisisReport {
  const meta = eventMeta(inc.event_type);
  const confidence = clampPct(inc.confidence_score * 100);
  // Multi-source or high-confidence clusters are escalated; thin ones go to
  // human review (mirrors the deterministic guidance grading on the backend).
  const status: ReportStatus =
    inc.report_count > 1 && inc.confidence_score >= 0.7 ? "relevant" : "review";

  const primary = inc.sources[0];
  const channels = Array.from(new Set(inc.sources.map((s) => s.source)));

  return {
    id: inc.id,
    title: `${meta.label} near ${nearestCity(inc.lat, inc.lon)}`,
    crisisType: meta.label,
    city: nearestCity(inc.lat, inc.lon),
    coordinates: [inc.lat, inc.lon],
    status,
    confidence,
    riskLevel: RISK_BY_SEVERITY[inc.severity],
    timestamp: inc.last_seen,
    aiSummary: `${inc.summary} Recommended action: ${inc.action_hint}`,
    locationConfidence: clampPct(60 + inc.report_count * 10),
    reasonForDecision:
      status === "relevant"
        ? `Escalated: ${inc.report_count} corroborating source(s) within the 1 km / 60 min cluster window (${channels.join(", ")}).`
        : `Human review: single-source or sub-threshold confidence; awaiting cross-source confirmation. ${inc.summary}`,
    breakdown: {
      sourceReliability: clampPct(inc.confidence_score * 95),
      locationMatch: clampPct(60 + inc.report_count * 10),
      mediaSupport: clampPct(inc.confidence_score * 80),
      crossSourceConfirmation: clampPct(inc.report_count * 28),
    },
    evidenceLinks: inc.sources.map(evidenceFromSource),
    signalSnippet: primary?.text ?? inc.summary,
    signalSource: primary
      ? `${primary.author} · ${sourceType(primary.source)}`
      : channels.join(", "),
    externalUrl: primary
      ? getWorkingUrl(primary.url, primary.text, primary.source, primary.author)
      : null,
  };
}

/** A report rejected by the credibility filter -> ignored CrisisReport. */
export function debunkedToReport(d: DebunkedReport): CrisisReport {
  const meta = eventMeta(d.event_type);
  const rawScore = d.text.toLowerCase().includes("#spaß") ? 0.06 : d.credibility_score;
  const confidence = clampPct(rawScore * 100);
  return {
    id: d.id,
    title: `Unverified: ${meta.label.toLowerCase()} claim, ${nearestCity(d.lat, d.lon)}`,
    crisisType: meta.label,
    city: nearestCity(d.lat, d.lon),
    coordinates: [d.lat, d.lon],
    status: "ignored",
    confidence,
    riskLevel: "Low",
    timestamp: d.timestamp,
    aiSummary: `Flagged by the AI credibility filter and withheld from escalation. ${d.reason_flagged}`,
    locationConfidence: clampPct(confidence * 0.6),
    reasonForDecision: `Ignored: ${d.reason_flagged}`,
    breakdown: {
      sourceReliability: clampPct(rawScore * 60),
      locationMatch: clampPct(confidence * 0.6),
      mediaSupport: clampPct(rawScore * 40),
      crossSourceConfirmation: clampPct(rawScore * 20),
    },
    evidenceLinks: [
      {
        sourceType: sourceType(d.source),
        title: `${d.author}: ${d.text}`.slice(0, 120),
        time: d.timestamp,
        credibility: credibilityBand(rawScore),
        href: getWorkingUrl(d.url, d.text, d.source, d.author),
      },
    ],
    signalSnippet: d.text,
    signalSource: `${d.author} · ${sourceType(d.source)}`,
    externalUrl: getWorkingUrl(d.url, d.text, d.source, d.author),
  };
}

/** Merge both backend feeds into one newest-first CrisisReport list. */
export function toCrisisReports(
  incidents: VerifiedIncident[],
  debunked: DebunkedReport[],
): CrisisReport[] {
  return [
    ...incidents.map(incidentToReport),
    ...debunked.map(debunkedToReport),
  ].sort(
    (a, b) =>
      safeNewDate(b.timestamp).getTime() - safeNewDate(a.timestamp).getTime(),
  );
}
