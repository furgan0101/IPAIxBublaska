/**
 * Adapts the live backend API (VerifiedIncident / DebunkedReport) into the
 * CrisisLens `CrisisReport` view model, so the whole dashboard — map, signal
 * rail, dossier — renders real data without touching the components.
 */
import { eventMeta } from "@/lib/eventMeta";
import { getWorkingUrl } from "@/lib/urls";
import { blendConfidence } from "@/lib/confidence";
import type {
  Credibility,
  CrisisReport,
  EvidenceLink,
  RiskLevel,
  SourceType,
} from "@/lib/mockReports";
import type {
  DebunkedReport,
  SourceReport,
  VerifiedIncident,
} from "@/lib/types";

const SOURCE_TYPE: Record<string, SourceType> = {
  mastodon: "Social Media",
  twitter: "Social Media",
  telegram: "Social Media",
  presseportal: "Local News",
  nina: "Weather Alert",
  dwd: "Weather Alert",
  pegelonline: "Weather Alert",
  usgs: "Weather Alert",
  eonet: "Weather Alert",
  gdacs: "Weather Alert",
};

/** Authority-verified channels: federal/official monitoring + agency feeds. */
const OFFICIAL_SOURCES = new Set([
  "nina",
  "presseportal",
  "dwd",
  "pegelonline",
  "usgs",
  "eonet",
  "gdacs",
]);

const RISK_BY_SEVERITY: Record<string, RiskLevel> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

function sourceTypeFor(source: string): SourceType {
  return SOURCE_TYPE[source] ?? "Citizen Report";
}

function credibilityFor(source: string): Credibility {
  return OFFICIAL_SOURCES.has(source) ? "high" : "medium";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function flagRuleName(reason: string): string {
  if (reason.startsWith("Recycled footage")) return "temporal check";
  if (reason.startsWith("Geotag conflict")) return "spatial check";
  if (reason.startsWith("Bot-spam")) return "linguistic check";
  if (reason.startsWith("AI Parsing")) return "output guard";
  return "AI analyst";
}

function evidenceFrom(source: SourceReport): EvidenceLink {
  const resolvedHref = getWorkingUrl(source.url, source.text, source.source, source.author);
  return {
    sourceType: sourceTypeFor(source.source),
    title: `${source.author}: ${truncate(source.text, 90)}`,
    time: source.timestamp,
    credibility: credibilityFor(source.source),
    href: resolvedHref,
    mediaPreview: source.media_preview ?? null,
  };
}

export function adaptIncident(incident: VerifiedIncident): CrisisReport {
  const label = eventMeta(incident.event_type).label;
  const newest = incident.sources[incident.sources.length - 1];
  const hasOfficial = incident.sources.some((s) =>
    OFFICIAL_SOURCES.has(s.source),
  );
  const officialCount = incident.sources.filter((s) =>
    OFFICIAL_SOURCES.has(s.source),
  ).length;
  const rationales = incident.sources
    .map((s) => s.ai_rationale)
    .filter((x): x is string => Boolean(x));
  const mediaNotes = incident.sources
    .map((s) => s.ai_media_note)
    .filter((x): x is string => Boolean(x));
  const mediaPreviews = incident.sources
    .map((s) => s.media_preview)
    .filter((x): x is string => Boolean(x))
    .slice(0, 4);
  const status: CrisisReport["status"] =
    incident.confidence_score >= 0.7 ? "relevant" : "review";
  const locationConfidence = Math.min(95, 70 + incident.report_count * 5);
  const latestRationale = rationales[rationales.length - 1];

  return {
    id: incident.id,
    title: `${label} — ${incident.report_count} corroborating source${
      incident.report_count === 1 ? "" : "s"
    }`,
    crisisType: label,
    city: "Konstanz sector",
    coordinates: [incident.lat, incident.lon],
    status,
    confidence: blendConfidence({
      verdict: "verified",
      corroboration: incident.confidence_score,
      reportCount: incident.report_count,
      officialCount,
    }),
    riskLevel: RISK_BY_SEVERITY[incident.severity] ?? "Low",
    timestamp: incident.last_seen,
    aiSummary:
      (latestRationale ? `AI analyst: ${latestRationale} ` : "") +
      `${incident.summary}. Recommended action: ${incident.action_hint}`,
    locationConfidence,
    reasonForDecision:
      status === "relevant"
        ? `Escalated: ${incident.report_count} independent source${
            incident.report_count === 1 ? "" : "s"
          } within a 1.0 km / 60 min window${
            hasOfficial ? ", including an official channel (NINA / police)" : ""
          }. Human confirmation still required before any operational response.`
        : "Human review required: low corroboration so far — awaiting cross-source confirmation before escalation.",
    breakdown: {
      sourceReliability: hasOfficial ? 90 : 65,
      locationMatch: locationConfidence,
      mediaSupport: mediaNotes.length > 0 ? 80 : mediaPreviews.length > 0 ? 60 : 35,
      crossSourceConfirmation: Math.min(95, 25 + incident.report_count * 22),
    },
    evidenceLinks: [...incident.sources].reverse().map(evidenceFrom),
    signalSnippet: newest ? truncate(newest.text, 140) : incident.summary,
    signalSource: newest
      ? `${newest.author} · ${sourceTypeFor(newest.source)}`
      : "—",
    mediaPreviews,
    mediaConsistency: mediaNotes[mediaNotes.length - 1] ?? null,
    externalUrl: newest
      ? getWorkingUrl(newest.url, newest.text, newest.source, newest.author)
      : null,
  };
}

export function adaptDebunked(report: DebunkedReport): CrisisReport {
  const label = eventMeta(report.event_type).label;
  return {
    id: report.id,
    title: `${label} claim — debunked`,
    crisisType: label,
    city: "Konstanz sector",
    coordinates: [report.lat, report.lon],
    status: "ignored",
    confidence: blendConfidence({
      verdict: "debunked",
      credibility: report.credibility_score,
    }),
    riskLevel: "Low",
    timestamp: report.timestamp,
    aiSummary: report.rationale ?? report.reason_flagged,
    locationConfidence: 35,
    reasonForDecision: `Ignored — ${flagRuleName(report.reason_flagged)}: ${report.reason_flagged}`,
    breakdown: {
      sourceReliability: 20,
      locationMatch: 35,
      mediaSupport: report.media_consistency ? 15 : 25,
      crossSourceConfirmation: 10,
    },
    evidenceLinks: [
      {
        sourceType: sourceTypeFor(report.source),
        title: `${report.author}: ${truncate(report.text, 90)}`,
        time: report.timestamp,
        credibility: "low",
        href: getWorkingUrl(report.url, report.text, report.source, report.author),
        mediaPreview: report.media_preview ?? null,
      },
    ],
    signalSnippet: truncate(report.text, 140),
    signalSource: `${report.author} · ${sourceTypeFor(report.source)}`,
    mediaPreviews: report.media_preview ? [report.media_preview] : [],
    mediaConsistency: report.media_consistency ?? null,
    externalUrl: getWorkingUrl(report.url, report.text, report.source, report.author),
  };
}

export function adaptAll(
  incidents: VerifiedIncident[],
  debunked: DebunkedReport[],
): CrisisReport[] {
  return [...incidents.map(adaptIncident), ...debunked.map(adaptDebunked)];
}

export const toReports = adaptAll;
