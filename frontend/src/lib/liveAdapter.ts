/**
 * Maps the backend pipeline output (VerifiedIncident / DebunkedReport, see
 * lib/types.ts ← backend/schemas.py) into the CrisisLens UI shape (CrisisReport).
 *
 * The backend gives us ground facts — event type, centroid, confidence,
 * severity, corroborating sources. The UI additionally shows a few advisory,
 * derived figures (a location-confidence and a four-part confidence
 * breakdown). Those are computed here deterministically from the backend
 * data and clearly labelled "AI-assisted" in the UI — they are estimates,
 * never claimed as ground truth.
 */

import { eventMeta } from "@/lib/eventMeta";
import type { DebunkedReport, SourceReport, VerifiedIncident } from "@/lib/types";
import type {
  ConfidenceBreakdown,
  Credibility,
  CrisisReport,
  EvidenceLink,
  ReportStatus,
  RiskLevel,
  SourceType,
} from "@/lib/mockReports";

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, Math.round(n)));

// --- Baden-Württemberg gazetteer (sector-focused) ------------------------------
// Nearest-city lookup so live centroids read as a place name, not raw coords.

const BW_CITIES: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  { name: "Konstanz", lat: 47.6603, lon: 9.1758 },
  { name: "Radolfzell", lat: 47.7401, lon: 8.9706 },
  { name: "Singen", lat: 47.7594, lon: 8.8403 },
  { name: "Friedrichshafen", lat: 47.6543, lon: 9.4795 },
  { name: "Ravensburg", lat: 47.7818, lon: 9.6107 },
  { name: "Überlingen", lat: 47.7697, lon: 9.1614 },
  { name: "Villingen-Schwenningen", lat: 48.0606, lon: 8.4594 },
  { name: "Stuttgart", lat: 48.7758, lon: 9.1829 },
  { name: "Freiburg", lat: 47.999, lon: 7.8421 },
  { name: "Karlsruhe", lat: 49.0069, lon: 8.4037 },
  { name: "Mannheim", lat: 49.4875, lon: 8.466 },
  { name: "Ulm", lat: 48.4011, lon: 9.9876 },
  { name: "Heidelberg", lat: 49.3988, lon: 8.6724 },
  { name: "Heilbronn", lat: 49.1427, lon: 9.2109 },
  { name: "Tübingen", lat: 48.5216, lon: 9.0576 },
  { name: "Reutlingen", lat: 48.4914, lon: 9.2043 },
  { name: "Pforzheim", lat: 48.8922, lon: 8.6946 },
  { name: "Offenburg", lat: 48.4709, lon: 7.9446 },
];

function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestCity(lat: number, lon: number): string {
  let best = BW_CITIES[0];
  let bestKm = Infinity;
  for (const city of BW_CITIES) {
    const km = haversineKm({ lat, lon }, city);
    if (km < bestKm) {
      bestKm = km;
      best = city;
    }
  }
  // Within ~30 km we trust the city label; otherwise stay generic.
  return bestKm <= 30 ? best.name : "Baden-Württemberg sector";
}

// --- Source platform → UI source type / credibility ----------------------------

function sourceType(platform: string): SourceType {
  const p = platform.toLowerCase();
  if (p.includes("presseportal") || p.includes("news")) return "Local News";
  if (p.includes("nina") || p.includes("dwd") || p.includes("warn"))
    return "Weather Alert";
  if (p.includes("telegram")) return "Forum";
  if (p.includes("citizen") || p === "live") return "Citizen Report";
  return "Social Media"; // twitter, mastodon, etc.
}

function platformCredibility(platform: string): Credibility {
  const p = platform.toLowerCase();
  if (p.includes("presseportal") || p.includes("nina") || p.includes("news"))
    return "high";
  if (p.includes("telegram")) return "low";
  return "medium";
}

const SEVERITY_STATUS: Record<VerifiedIncident["severity"], ReportStatus> = {
  high: "relevant",
  moderate: "review",
  low: "review",
};

const SEVERITY_RISK: Record<VerifiedIncident["severity"], RiskLevel> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

function evidenceFromSource(s: SourceReport): EvidenceLink {
  const raw = s.text.replace(/\s+/g, " ").trim();
  const title =
    raw.length > 96 ? `${raw.slice(0, 96)}…` : raw || `Report ${s.id}`;
  return {
    sourceType: sourceType(s.source),
    title,
    time: s.timestamp,
    credibility: platformCredibility(s.source),
    href: s.url ?? "#",
  };
}

function deriveBreakdown(
  confidence: number,
  reportCount: number,
  sources: SourceReport[],
): ConfidenceBreakdown {
  const trust = sources.length
    ? Math.round(
        sources.reduce((sum, s) => {
          const c = platformCredibility(s.source);
          return sum + (c === "high" ? 88 : c === "medium" ? 62 : 42);
        }, 0) / sources.length,
      )
    : 60;
  const hasMedia = sources.some((s) => Boolean(s.url));
  return {
    sourceReliability: clamp(trust),
    locationMatch: clamp(confidence - (reportCount > 1 ? 0 : 6)),
    mediaSupport: clamp(hasMedia ? 58 + (confidence - 60) * 0.4 : 34),
    crossSourceConfirmation: clamp(
      reportCount >= 3 ? 88 : reportCount === 2 ? 70 : 44,
    ),
  };
}

/** Convert a verified, geo-clustered incident into a UI report. */
export function incidentToReport(incident: VerifiedIncident): CrisisReport {
  const confidence = clamp(incident.confidence_score * 100);
  const meta = eventMeta(incident.event_type);
  const city = nearestCity(incident.lat, incident.lon);
  const status = SEVERITY_STATUS[incident.severity];
  const platforms = Array.from(
    new Set(incident.sources.map((s) => s.source)),
  ).join(", ");
  const newest = [...incident.sources].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )[0];

  const corroboration =
    `${incident.report_count} corroborating ` +
    `${incident.report_count === 1 ? "source" : "sources"}` +
    (platforms ? ` (${platforms})` : "");

  const aiSummary =
    `AI-assisted plausibility estimate ${confidence}% from ${corroboration}. ` +
    `${incident.action_hint} Escalation requires human confirmation.`;

  const reasonForDecision =
    status === "relevant"
      ? `Evidence-based escalation — severity ${incident.severity}, ${corroboration}, ` +
        `AI-assisted plausibility ${confidence}%. Human confirmation required before any response.`
      : `Human review required — ${corroboration}, AI-assisted plausibility ` +
        `${confidence}%. Awaiting further corroboration before escalation.`;

  const breakdown = deriveBreakdown(
    confidence,
    incident.report_count,
    incident.sources,
  );

  return {
    id: incident.id,
    title: `${meta.label} · ${city}`,
    crisisType: meta.label,
    city,
    coordinates: [incident.lat, incident.lon],
    status,
    confidence,
    riskLevel: SEVERITY_RISK[incident.severity],
    timestamp: incident.last_seen,
    aiSummary,
    locationConfidence: breakdown.locationMatch,
    reasonForDecision,
    breakdown,
    evidenceLinks: incident.sources.map(evidenceFromSource),
    signalSnippet: (newest?.text ?? incident.summary)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
    signalSource: newest
      ? `${newest.author} · ${sourceType(newest.source)}`
      : "Verified incident",
  };
}

/** Convert a filter-rejected report into an "ignored" UI report. */
export function debunkedToReport(d: DebunkedReport): CrisisReport {
  const confidence = clamp(d.credibility_score * 100);
  const meta = eventMeta(d.event_type);
  const city = nearestCity(d.lat, d.lon);
  const snippet = d.text.replace(/\s+/g, " ").trim();

  return {
    id: d.id,
    title: `${meta.label} signal · ${city}`,
    crisisType: meta.label,
    city,
    coordinates: [d.lat, d.lon],
    status: "ignored",
    confidence,
    riskLevel: "Low",
    timestamp: d.timestamp,
    aiSummary:
      `Ignored due to insufficient corroboration. The credibility filter flagged this ` +
      `signal (AI-assisted credibility ${confidence}%): ${d.reason_flagged} ` +
      `It will be re-evaluated automatically if corroborating reports arrive.`,
    locationConfidence: clamp(confidence),
    reasonForDecision: `Ignored due to insufficient corroboration — ${d.reason_flagged}`,
    breakdown: {
      sourceReliability: clamp(confidence),
      locationMatch: clamp(confidence),
      mediaSupport: clamp(confidence - 10),
      crossSourceConfirmation: clamp(confidence - 20),
    },
    evidenceLinks: [
      {
        sourceType: sourceType(d.source),
        title: snippet.length > 96 ? `${snippet.slice(0, 96)}…` : snippet,
        time: d.timestamp,
        credibility: "low",
        href: d.url ?? "#",
      },
    ],
    signalSnippet: snippet.slice(0, 160),
    signalSource: `${d.author} · ${sourceType(d.source)}`,
  };
}

/** Full pipeline snapshot → UI reports (incidents first, then ignored). */
export function toReports(
  incidents: VerifiedIncident[],
  debunked: DebunkedReport[],
): CrisisReport[] {
  return [
    ...incidents.map(incidentToReport),
    ...debunked.map(debunkedToReport),
  ];
}
