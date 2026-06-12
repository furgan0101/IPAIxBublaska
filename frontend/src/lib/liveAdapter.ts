/**
 * Adapts the live backend API (VerifiedIncident / DebunkedReport) into the
 * CrisisLens `CrisisReport` view model, so the whole dashboard — map, signal
 * rail, dossier — renders real data without touching the components.
 */
import { eventMeta } from "@/lib/eventMeta";
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
  bluesky: "Social Media",
  presseportal: "Local News",
  feuerwehr: "Local News",
  nina: "Weather Alert",
};

/** Authority-verified channels (federal warnings, police + fire newsrooms). */
const OFFICIAL_SOURCES = new Set(["nina", "presseportal", "feuerwehr"]);

const OFFICIAL_LABELS: Record<string, string> = {
  nina: "NINA",
  presseportal: "police",
  feuerwehr: "fire service",
};

const RISK_BY_SEVERITY: Record<string, RiskLevel> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

/**
 * Nearest-city lookup so live incidents carry a real place name (drives the
 * city focus grouping). Major Baden-Württemberg cities and district towns;
 * anything further than ~30 km from all of them falls back to the state name.
 */
const BW_CITIES: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  { name: "Stuttgart", lat: 48.7758, lon: 9.1829 },
  { name: "Mannheim", lat: 49.4875, lon: 8.466 },
  { name: "Karlsruhe", lat: 49.0069, lon: 8.4037 },
  { name: "Freiburg", lat: 47.999, lon: 7.8421 },
  { name: "Heidelberg", lat: 49.3988, lon: 8.6724 },
  { name: "Heilbronn", lat: 49.1427, lon: 9.2109 },
  { name: "Ulm", lat: 48.4011, lon: 9.9876 },
  { name: "Pforzheim", lat: 48.8922, lon: 8.6946 },
  { name: "Reutlingen", lat: 48.4914, lon: 9.2043 },
  { name: "Esslingen", lat: 48.7406, lon: 9.3108 },
  { name: "Ludwigsburg", lat: 48.8976, lon: 9.1916 },
  { name: "Tübingen", lat: 48.5216, lon: 9.0576 },
  { name: "Villingen-Schwenningen", lat: 48.0608, lon: 8.4586 },
  { name: "Konstanz", lat: 47.6603, lon: 9.1758 },
  { name: "Friedrichshafen", lat: 47.6549, lon: 9.4797 },
  { name: "Ravensburg", lat: 47.7819, lon: 9.6116 },
  { name: "Singen", lat: 47.7623, lon: 8.84 },
  { name: "Radolfzell", lat: 47.7372, lon: 8.971 },
  { name: "Tuttlingen", lat: 47.9847, lon: 8.8233 },
  { name: "Rottweil", lat: 48.1681, lon: 8.6247 },
  { name: "Offenburg", lat: 48.4736, lon: 7.9407 },
  { name: "Baden-Baden", lat: 48.7606, lon: 8.2396 },
  { name: "Lörrach", lat: 47.6167, lon: 7.6582 },
  { name: "Göppingen", lat: 48.7025, lon: 9.6529 },
  { name: "Aalen", lat: 48.8378, lon: 10.0933 },
  { name: "Schwäbisch Gmünd", lat: 48.7989, lon: 9.7977 },
  { name: "Sindelfingen", lat: 48.7131, lon: 9.0033 },
  { name: "Böblingen", lat: 48.685, lon: 9.0119 },
  { name: "Waiblingen", lat: 48.8304, lon: 9.3169 },
  { name: "Heidenheim", lat: 48.6766, lon: 10.1545 },
  { name: "Bruchsal", lat: 49.1242, lon: 8.598 },
  { name: "Rastatt", lat: 48.8575, lon: 8.211 },
  { name: "Albstadt", lat: 48.2119, lon: 9.0239 },
  { name: "Biberach", lat: 48.098, lon: 9.7886 },
];

/** ~30 km in degrees latitude — beyond this, no city label is claimed. */
const MAX_CITY_DISTANCE_DEG = 0.3;
const LON_WEIGHT = 0.67; // cos(48°) — meters per degree shrink with latitude

function nearestCity(lat: number, lon: number): string | null {
  let bestName: string | null = null;
  let bestD = MAX_CITY_DISTANCE_DEG ** 2;
  for (const city of BW_CITIES) {
    const dLat = city.lat - lat;
    const dLon = (city.lon - lon) * LON_WEIGHT;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      bestName = city.name;
    }
  }
  return bestName;
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
  return {
    sourceType: sourceTypeFor(source.source),
    title: `${source.author}: ${truncate(source.text, 90)}`,
    time: source.timestamp,
    credibility: credibilityFor(source.source),
    href: source.url ?? "#",
    mediaPreview: source.media_preview ?? null,
  };
}

export function adaptIncident(incident: VerifiedIncident): CrisisReport {
  const label = eventMeta(incident.event_type).label;
  const newest = incident.sources[incident.sources.length - 1];
  const officialChannels = [
    ...new Set(
      incident.sources
        .filter((s) => OFFICIAL_SOURCES.has(s.source))
        .map((s) => OFFICIAL_LABELS[s.source] ?? s.source),
    ),
  ];
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
  const city = nearestCity(incident.lat, incident.lon);

  return {
    id: incident.id,
    title: city ? `${label} near ${city}` : `${label} report`,
    crisisType: label,
    city: city ?? "Baden-Württemberg",
    coordinates: [incident.lat, incident.lon],
    status,
    confidence: Math.round(incident.confidence_score * 100),
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
            officialChannels.length > 0
              ? `, including official channels (${officialChannels.join(", ")})`
              : ""
          }. Human confirmation is still required before any operational response.`
        : "Human review required: low corroboration so far — awaiting cross-source confirmation before escalation.",
    breakdown: {
      sourceReliability: officialChannels.length > 0 ? 90 : 65,
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
    externalUrl: newest?.url ?? null,
  };
}

export function adaptDebunked(report: DebunkedReport): CrisisReport {
  const label = eventMeta(report.event_type).label;
  const city = nearestCity(report.lat, report.lon);
  return {
    id: report.id,
    title: city
      ? `Unverified ${label.toLowerCase()} claim — ${city}`
      : `Unverified ${label.toLowerCase()} claim`,
    crisisType: label,
    city: city ?? "Baden-Württemberg",
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
        href: report.url ?? "#",
        mediaPreview: report.media_preview ?? null,
      },
    ],
    signalSnippet: truncate(report.text, 140),
    signalSource: `${report.author} · ${sourceTypeFor(report.source)}`,
    mediaPreviews: report.media_preview ? [report.media_preview] : [],
    mediaConsistency: report.media_consistency ?? null,
    externalUrl: report.url ?? null,
  };
}

export function adaptAll(
  incidents: VerifiedIncident[],
  debunked: DebunkedReport[],
): CrisisReport[] {
  return [...incidents.map(adaptIncident), ...debunked.map(adaptDebunked)];
}

export const toReports = adaptAll;
