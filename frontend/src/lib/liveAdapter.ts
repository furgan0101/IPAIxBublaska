/**
 * Adapts the live backend API (VerifiedIncident / DebunkedReport) into the
 * CrisisLens `CrisisReport` view model, so the whole dashboard — map, signal
 * rail, dossier — renders real data without touching the components.
 */
import { eventMeta } from "@/lib/eventMeta";
import { getWorkingUrl } from "@/lib/urls";
import type {
  Credibility,
  CrisisReport,
  EvidenceLink,
  RiskLevel,
  SourceType,
} from "@/lib/reportTypes";
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
};

/** Authority-verified channels (federal warnings, police newsroom). */
const OFFICIAL_SOURCES = new Set(["nina", "presseportal"]);

const RISK_BY_SEVERITY: Record<string, RiskLevel> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

/** Coarse nearest-city label. Covers BW (Command Mode) plus the major German
 *  cities, so nationwide ingestion (Lever A) labels incidents sensibly. */
const CITY_LABELS: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  // Baden-Württemberg
  { name: "Konstanz", lat: 47.6603, lon: 9.1758 },
  { name: "Stuttgart", lat: 48.7758, lon: 9.1829 },
  { name: "Karlsruhe", lat: 49.0069, lon: 8.4037 },
  { name: "Freiburg", lat: 47.999, lon: 7.8421 },
  { name: "Mannheim", lat: 49.4875, lon: 8.466 },
  { name: "Ulm", lat: 48.4011, lon: 9.9876 },
  { name: "Heidelberg", lat: 49.3988, lon: 8.6724 },
  { name: "Heilbronn", lat: 49.1427, lon: 9.2109 },
  { name: "Tübingen", lat: 48.5216, lon: 9.0576 },
  { name: "Reutlingen", lat: 48.4914, lon: 9.2043 },
  { name: "Pforzheim", lat: 48.8922, lon: 8.6946 },
  { name: "Offenburg", lat: 48.4738, lon: 7.945 },
  { name: "Ravensburg", lat: 47.7818, lon: 9.6107 },
  // Major German cities (national)
  { name: "Berlin", lat: 52.52, lon: 13.405 },
  { name: "Hamburg", lat: 53.5511, lon: 9.9937 },
  { name: "München", lat: 48.1351, lon: 11.582 },
  { name: "Köln", lat: 50.9375, lon: 6.9603 },
  { name: "Frankfurt", lat: 50.1109, lon: 8.6821 },
  { name: "Düsseldorf", lat: 51.2277, lon: 6.7735 },
  { name: "Dortmund", lat: 51.5136, lon: 7.4653 },
  { name: "Essen", lat: 51.4556, lon: 7.0116 },
  { name: "Bremen", lat: 53.0793, lon: 8.8017 },
  { name: "Hannover", lat: 52.3759, lon: 9.732 },
  { name: "Nürnberg", lat: 49.4521, lon: 11.0767 },
  { name: "Leipzig", lat: 51.3397, lon: 12.3731 },
  { name: "Dresden", lat: 51.0504, lon: 13.7373 },
  { name: "Aurich", lat: 53.4717, lon: 7.4836 },
  { name: "Kiel", lat: 54.3233, lon: 10.1228 },
  { name: "Münster", lat: 51.9607, lon: 7.6261 },
];

function nearestCity(lat: number, lon: number): string {
  let best = CITY_LABELS[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of CITY_LABELS) {
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.name;
}

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

/** Shown in feeds/tooltips wherever raw intel of a classified incident would appear. */
const RESTRICTED_SNIPPET =
  "Raw intelligence restricted — information discipline active.";

export function adaptIncident(incident: VerifiedIncident): CrisisReport {
  const label = eventMeta(incident.event_type).label;
  const newest = incident.sources[incident.sources.length - 1];
  const hasOfficial = incident.sources.some((s) =>
    OFFICIAL_SOURCES.has(s.source),
  );
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
  // Information discipline: mask raw intel (media, source feed, snippets) at
  // the adapter boundary so no consumer — map, rail, dossier — can leak it.
  const classified = incident.classified ?? false;

  return {
    id: incident.id,
    title: `${label} — ${incident.report_count} corroborating source${
      incident.report_count === 1 ? "" : "s"
    }`,
    crisisType: label,
    city: nearestCity(incident.lat, incident.lon),
    coordinates: [incident.lat, incident.lon],
    status,
    confidence: Math.round(incident.confidence_score * 100),
    riskLevel: RISK_BY_SEVERITY[incident.severity] ?? "Low",
    timestamp: incident.last_seen,
    aiSummary: classified
      ? `${incident.summary}.`
      : (latestRationale ? `AI analyst: ${latestRationale} ` : "") +
        `${incident.summary}.`,
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
    evidenceLinks: classified
      ? []
      : [...incident.sources].reverse().map(evidenceFrom),
    signalSnippet: classified
      ? RESTRICTED_SNIPPET
      : newest
        ? truncate(newest.text, 140)
        : incident.summary,
    signalSource: classified
      ? "Police Command · restricted channel"
      : newest
        ? `${newest.author} · ${sourceTypeFor(newest.source)}`
        : "—",
    mediaPreviews: classified ? [] : mediaPreviews,
    mediaConsistency: classified
      ? null
      : (mediaNotes[mediaNotes.length - 1] ?? null),
    externalUrl:
      classified || !newest
        ? null
        : getWorkingUrl(newest.url, newest.text, newest.source, newest.author),
    actionHint: incident.action_hint,
    sopTasks: incident.sop_tasks ?? [],
    dispatched: incident.dispatched ?? false,
    dispatchedAt: incident.dispatched_at ?? null,
    classified,
  };
}

export function adaptDebunked(report: DebunkedReport): CrisisReport {
  const label = eventMeta(report.event_type).label;
  return {
    id: report.id,
    title: `${label} claim — debunked`,
    crisisType: label,
    city: nearestCity(report.lat, report.lon),
    coordinates: [report.lat, report.lon],
    status: "ignored",
    confidence: Math.round(report.credibility_score * 100),
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
