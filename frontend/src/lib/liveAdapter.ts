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

/** Coarse nearest-city label so Command Mode can scope statewide BW data. */
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
  // `status` is retained on the view-model for compatibility, but the UI no
  // longer renders a triage verdict — signals are coloured by trust instead.
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
    eventType: incident.event_type,
    city: nearestCity(incident.lat, incident.lon),
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
      incident.summary,
    actionHint: incident.action_hint,
    locationConfidence,
    reasonForDecision: `${incident.report_count} independent source${
      incident.report_count === 1 ? "" : "s"
    } within a 1.0 km / 60 min window${
      hasOfficial ? ", including an official channel (NINA / police)" : ""
    }. Trust is derived from source reliability and cross-source corroboration; any operational response remains a human decision.`,
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
    related_incidents: incident.related_incidents,
  };
}

export function adaptDebunked(report: DebunkedReport): CrisisReport {
  const label = eventMeta(report.event_type).label;
  return {
    id: report.id,
    title: `${label} — uncorroborated claim`,
    crisisType: label,
    eventType: report.event_type,
    city: nearestCity(report.lat, report.lon),
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
    reasonForDecision: `Low trust — ${flagRuleName(report.reason_flagged)}: ${report.reason_flagged}`,
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

export function adaptSource(
  source: SourceReport,
  parent: VerifiedIncident,
): CrisisReport {
  const label = eventMeta(parent.event_type).label;
  return {
    id: source.id,
    title: `${label} — corroborating signal`,
    crisisType: label,
    eventType: parent.event_type,
    city: nearestCity(parent.lat, parent.lon),
    coordinates: [parent.lat, parent.lon],
    status: parent.confidence_score >= 0.7 ? "relevant" : "review",
    confidence: Math.round((source.ai_credibility ?? 0.5) * 100),
    riskLevel: RISK_BY_SEVERITY[parent.severity] ?? "Low",
    timestamp: source.timestamp,
    aiSummary: source.ai_rationale ?? parent.summary,
    locationConfidence: 50,
    reasonForDecision: `Corroborating source for incident ${parent.id}. Reliability: ${
      OFFICIAL_SOURCES.has(source.source) ? 95 : Math.round((source.ai_credibility ?? 0.5) * 100)
    }%`,
    breakdown: {
      sourceReliability: OFFICIAL_SOURCES.has(source.source) ? 95 : Math.round((source.ai_credibility ?? 0.5) * 100),
      locationMatch: 50,
      mediaSupport: source.media_preview ? 70 : 30,
      crossSourceConfirmation: Math.round(parent.confidence_score * 100),
    },
    evidenceLinks: [evidenceFrom(source)],
    signalSnippet: truncate(source.text, 140),
    signalSource: `${source.author} · ${sourceTypeFor(source.source)}`,
    mediaPreviews: source.media_preview ? [source.media_preview] : [],
    mediaConsistency: source.ai_media_note ?? null,
    externalUrl: getWorkingUrl(
      source.url,
      source.text,
      source.source,
      source.author,
    ),
  };
}

export function adaptAll(
  incidents: VerifiedIncident[],
  debunked: DebunkedReport[],
): CrisisReport[] {
  const incidentReports = incidents.map(adaptIncident);
  // Single-source incidents are already fully represented by the
  // incident-level entry — skip the redundant source-level clone.
  const sourceReports = incidents.flatMap((inc) =>
    inc.sources.length > 1
      ? inc.sources.map((src) => adaptSource(src, inc))
      : [],
  );
  const debunkedReports = debunked.map(adaptDebunked);

  return [...incidentReports, ...sourceReports, ...debunkedReports];
}

export const toReports = adaptAll;
