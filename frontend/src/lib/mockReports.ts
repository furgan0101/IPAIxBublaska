/**
 * CrisisLens frontend mock dataset — Baden-Württemberg demo sector.
 * Purely synthetic: every account, snippet and link is fictional.
 * Timestamps are rebased to module-load time so the demo always looks live.
 */

import { getWorkingUrl } from "./urls";


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
  /** Live mode: thumbnail of the source's attached media. */
  mediaPreview?: string | null;
}

export interface ConfidenceBreakdown {
  sourceReliability: number;
  locationMatch: number;
  mediaSupport: number;
  crossSourceConfirmation: number;
}

export interface RelatedIncident {
  incident_id: string;
  relation_type: "causal" | "spatial" | "sequel";
  rationale: string;
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
  /** Live mode: thumbnails of the media the AI analyzed. */
  mediaPreviews?: string[];
  /** Live mode: AI note on whether the media matches the claim. */
  mediaConsistency?: string | null;
  /** Live mode: link to the original post/release. */
  externalUrl?: string | null;
  /** Raw event-type key (e.g. "fire", "flood") — used for map icons. */
  eventType?: string;
  /** Causal or semantic links to other reports. */
  related_incidents?: RelatedIncident[];
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

const NOW: number = Date.now();

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

export const MOCK_REPORTS: CrisisReport[] = [
  {
    id: "KN-0142",
    title: "Structure fire near Konstanz central station",
    crisisType: "Fire",
    eventType: "fire",
    city: "Konstanz",
    coordinates: [47.6594, 9.1744],
    status: "relevant",
    confidence: 82,
    riskLevel: "High",
    timestamp: minutesAgo(8),
    aiSummary:
      "Three independent sources describe visible smoke and open flames in a commercial building directly north of Konstanz central station. Photo metadata is consistent with the reported time window, and fire-service activity increased in the same period. Plausibility is high — evidence-based escalation recommended, pending confirmation by the duty officer.",
    locationConfidence: 91,
    reasonForDecision:
      "Escalated: three independent sources inside a 0.8 km / 22 min window, capture metadata consistent with report times, and corroborating fire-service activity. Human confirmation still required before any operational response.",
    breakdown: {
      sourceReliability: 84,
      locationMatch: 91,
      mediaSupport: 78,
      crossSourceConfirmation: 88,
    },
    evidenceLinks: [
      {
        sourceType: "Local News",
        title: "Südkurier live ticker: Rauchentwicklung am Hauptbahnhof",
        time: minutesAgo(6),
        credibility: "high",
        href: "#",
      },
      {
        sourceType: "Social Media",
        title: "@bodensee_spotter: Flammen im Dachstuhl sichtbar",
        time: minutesAgo(9),
        credibility: "medium",
        href: "#",
      },
      {
        sourceType: "Citizen Report",
        title: "Warn-app report: strong smell of smoke, Bahnhofplatz",
        time: minutesAgo(12),
        credibility: "medium",
        href: "#",
      },
    ],
    signalSnippet:
      "Rauchsäule über dem Bahnhofsviertel sichtbar, Löschzug im Anmarsch …",
    signalSource: "@bodensee_spotter · Social Media",
    },
    {
    id: "KN-0143",
    title: "Traffic congestion at Station Square",
    crisisType: "Traffic",
    eventType: "traffic",
    city: "Konstanz",
    coordinates: [47.6599, 9.176],
    status: "review",
    confidence: 65,
    riskLevel: "Low",
    timestamp: minutesAgo(5),
    aiSummary: "Multiple reports of heavy traffic and road blocks around the station area.",
    locationConfidence: 95,
    reasonForDecision: "Corroborated traffic disruption reports.",
    breakdown: {
      sourceReliability: 60,
      locationMatch: 95,
      mediaSupport: 30,
      crossSourceConfirmation: 70,
    },
    evidenceLinks: [],
    signalSnippet: "Stau am Bahnhofplatz, Polizei regelt den Verkehr.",
    signalSource: "@kn_traffic · Social Media",
    related_incidents: [
      {
        incident_id: "KN-0142",
        relation_type: "causal",
        rationale: "Traffic congestion is a direct consequence of the nearby structure fire and emergency vehicle access."
      }
    ]
    },
    {
    id: "UL-0288",

    title: "Multi-vehicle accident on B14 arterial road",
    crisisType: "Traffic Accident",
    eventType: "accident",
    city: "Stuttgart",
    coordinates: [48.7784, 9.18],
    status: "relevant",
    confidence: 76,
    riskLevel: "Moderate",
    timestamp: minutesAgo(14),
    aiSummary:
      "Two corroborating reports describe a multi-vehicle collision blocking the B14 near the city centre. A traffic-camera still matches the described lane closure, and flow data shows a sudden speed drop on the same segment. Escalated for dispatcher awareness; injury status unconfirmed.",
    locationConfidence: 88,
    reasonForDecision:
      "Escalated: independent social and citizen reports agree on segment and direction of travel; public traffic-flow data corroborates a sudden obstruction at the reported position.",
    breakdown: {
      sourceReliability: 78,
      locationMatch: 88,
      mediaSupport: 64,
      crossSourceConfirmation: 74,
    },
    evidenceLinks: [
      {
        sourceType: "Social Media",
        title: "@stau_alarm_bw: B14 stadteinwärts komplett dicht",
        time: minutesAgo(13),
        credibility: "medium",
        href: "#",
      },
      {
        sourceType: "Citizen Report",
        title: "Warn-app report: collision ahead of Charlottenplatz tunnel",
        time: minutesAgo(15),
        credibility: "medium",
        href: "#",
      },
      {
        sourceType: "Local News",
        title: "SWR traffic desk: lane closure confirmed on B14",
        time: minutesAgo(10),
        credibility: "high",
        href: "#",
      },
    ],
    signalSnippet:
      "B14 stadteinwärts steht alles, mehrere Fahrzeuge beteiligt, Blaulicht vor Ort …",
    signalSource: "@stau_alarm_bw · Social Media",
  },
  {
    id: "FR-0311",
    title: "Flooding on riverside road along the Dreisam",
    crisisType: "Flooding",
    eventType: "flood",
    city: "Freiburg",
    coordinates: [47.992, 7.855],
    status: "review",
    confidence: 68,
    riskLevel: "Moderate",
    timestamp: minutesAgo(23),
    aiSummary:
      "Reports describe water across the carriageway on the Dreisam riverside road after sustained rainfall. Imagery is plausible but could not be independently dated, and the two available sources partially overlap. Routed to human review before any escalation.",
    locationConfidence: 72,
    reasonForDecision:
      "Human review required: river-gauge data shows elevated but below-threshold levels, and the media evidence could not be independently dated. Plausible, not yet corroborated.",
    breakdown: {
      sourceReliability: 62,
      locationMatch: 72,
      mediaSupport: 55,
      crossSourceConfirmation: 60,
    },
    evidenceLinks: [
      {
        sourceType: "Weather Alert",
        title: "DWD heavy-rain advisory active for Breisgau region",
        time: minutesAgo(41),
        credibility: "high",
        href: "#",
      },
      {
        sourceType: "Social Media",
        title: "@dreisam_pegel: Uferweg läuft voll, Straße teils überspült",
        time: minutesAgo(24),
        credibility: "medium",
        href: "#",
      },
      {
        sourceType: "Citizen Report",
        title: "Warn-app report: water entering underpass at Sandfangweg",
        time: minutesAgo(27),
        credibility: "low",
        href: "#",
      },
    ],
    signalSnippet:
      "Dreisamuferstraße teils überspült, Autos wenden auf der Fahrbahn …",
    signalSource: "@dreisam_pegel · Social Media",
  },
  {
    id: "KA-0193",
    title: "Clustered power-outage reports, Oststadt district",
    crisisType: "Power Outage",
    eventType: "power_outage",
    city: "Karlsruhe",
    coordinates: [49.0098, 8.431],
    status: "relevant",
    confidence: 74,
    riskLevel: "Moderate",
    timestamp: minutesAgo(31),
    aiSummary:
      "A tight cluster of outage reports from the Oststadt district coincides with the grid operator's public fault map showing a medium-voltage disturbance. Escalated for situational awareness; scope, cause and restoration time remain unconfirmed.",
    locationConfidence: 83,
    reasonForDecision:
      "Escalated: independent reports form a tight spatial cluster that matches the operator's published fault polygon. No imagery available, but source agreement is strong.",
    breakdown: {
      sourceReliability: 80,
      locationMatch: 83,
      mediaSupport: 41,
      crossSourceConfirmation: 76,
    },
    evidenceLinks: [
      {
        sourceType: "Local News",
        title: "BNN: Stromausfall in der Oststadt, Netzbetreiber prüft",
        time: minutesAgo(26),
        credibility: "high",
        href: "#",
      },
      {
        sourceType: "Forum",
        title: "ka-forum thread: \"Strom weg seit 20:40 — wer noch?\"",
        time: minutesAgo(33),
        credibility: "medium",
        href: "#",
      },
      {
        sourceType: "Citizen Report",
        title: "Warn-app report: traffic lights dark at Durlacher Tor",
        time: minutesAgo(29),
        credibility: "medium",
        href: "#",
      },
    ],
    signalSnippet:
      "Halbe Oststadt ohne Strom, Ampeln an der Durlacher Allee dunkel …",
    signalSource: "ka-forum · Forum",
  },
  {
    id: "MA-0356",
    title: "Unverified explosion rumour, Neckarstadt",
    crisisType: "Explosion Rumour",
    eventType: "explosion",
    city: "Mannheim",
    coordinates: [49.4944, 8.466],
    status: "ignored",
    confidence: 31,
    riskLevel: "Low",
    timestamp: minutesAgo(47),
    aiSummary:
      "A single account claims an explosion in Neckarstadt. The attached video matches archive footage from a 2019 event in another city, and no other source reports unusual activity in the area. Ignored due to insufficient corroboration; will be re-evaluated automatically if new signals arrive.",
    locationConfidence: 34,
    reasonForDecision:
      "Ignored due to insufficient corroboration: recycled footage (reverse-image match, 2019), no second source, and the posting account was created three days ago with a bot-like activity pattern.",
    breakdown: {
      sourceReliability: 18,
      locationMatch: 34,
      mediaSupport: 12,
      crossSourceConfirmation: 9,
    },
    evidenceLinks: [
      {
        sourceType: "Social Media",
        title: "@blitz_news_24: \"RIESEN-EXPLOSION in Mannheim!!\"",
        time: minutesAgo(47),
        credibility: "low",
        href: "#",
      },
      {
        sourceType: "Forum",
        title: "rhein-neckar forum: nobody nearby heard anything",
        time: minutesAgo(39),
        credibility: "medium",
        href: "#",
      },
    ],
    signalSnippet:
      "RIESEN-EXPLOSION in der Neckarstadt!! Teilt das Video, bevor es gelöscht wird!!",
    signalSource: "@blitz_news_24 · Social Media",
  },
  {
    id: "UL-0228",
    title: "Storm damage blocking road near the Münster",
    crisisType: "Storm Damage",
    eventType: "storm",
    city: "Ulm",
    coordinates: [48.3994, 9.9916],
    status: "relevant",
    confidence: 79,
    riskLevel: "Moderate",
    timestamp: minutesAgo(38),
    aiSummary:
      "Multiple sources report a toppled construction barrier and large branches blocking an access road after a squall line crossed Ulm. The reports are consistent with the gust warning active at the time. Escalated so road clearance can be coordinated; no injuries reported so far.",
    locationConfidence: 86,
    reasonForDecision:
      "Escalated: cross-source confirmation from an official weather warning, citizen photos and a local-news ticker; photo capture times fall inside the squall window.",
    breakdown: {
      sourceReliability: 76,
      locationMatch: 86,
      mediaSupport: 72,
      crossSourceConfirmation: 81,
    },
    evidenceLinks: [
      {
        sourceType: "Weather Alert",
        title: "DWD gust warning level 2 for Ulm / Alb-Donau",
        time: minutesAgo(55),
        credibility: "high",
        href: "#",
      },
      {
        sourceType: "Citizen Report",
        title: "Warn-app photo: branches across Münsterplatz access road",
        time: minutesAgo(37),
        credibility: "medium",
        href: "#",
      },
      {
        sourceType: "Local News",
        title: "SWP ticker: clean-up crews dispatched after squall",
        time: minutesAgo(31),
        credibility: "high",
        href: "#",
      },
    ],
    signalSnippet:
      "Bauzaun umgekippt, dicke Äste auf der Zufahrt am Münsterplatz — kommt keiner durch …",
    signalSource: "Warn-app · Citizen Report",
  },
  {
    id: "HD-0301",
    title: "Crowd panic rumour, Heidelberg old town",
    crisisType: "Crowd Incident Rumour",
    eventType: "terror_attack",
    city: "Heidelberg",
    coordinates: [49.4122, 8.71],
    status: "ignored",
    confidence: 28,
    riskLevel: "Low",
    timestamp: minutesAgo(52),
    aiSummary:
      "Two forum posts claim a crowd panic near the old town. Public webcams show normal pedestrian flow during the claimed window, and neither news nor official channels reflect the claim. Ignored due to insufficient corroboration.",
    locationConfidence: 41,
    reasonForDecision:
      "Ignored due to insufficient corroboration: directly contradicted by public webcam imagery from the claimed location and time; no official, news or social source reflects the claim.",
    breakdown: {
      sourceReliability: 22,
      locationMatch: 41,
      mediaSupport: 15,
      crossSourceConfirmation: 11,
    },
    evidenceLinks: [
      {
        sourceType: "Forum",
        title: "hd-talk thread: \"Massenpanik in der Altstadt?!\"",
        time: minutesAgo(52),
        credibility: "low",
        href: "#",
      },
      {
        sourceType: "Social Media",
        title: "@hd_altstadt webcam repost: normal foot traffic visible",
        time: minutesAgo(44),
        credibility: "medium",
        href: "#",
      },
    ],
    signalSnippet:
      "Angeblich Massenpanik in der Hauptstraße — \"alle rennen\", keine Quelle, kein Video …",
    signalSource: "hd-talk · Forum",
  },
  {
    id: "HN-0275",
    title: "DWD Wind Warning: Severe Gusts (Level 2)",
    crisisType: "Storm Warning",
    eventType: "storm",
    city: "Heilbronn",
    coordinates: [49.1427, 9.2109],
    status: "relevant",
    confidence: 100,
    riskLevel: "Moderate",
    timestamp: minutesAgo(2),
    aiSummary:
      "Official DWD weather warning for the Heilbronn area. Severe gusts up to 85 km/h expected. Higher elevations may see gusts up to 100 km/h.",
    locationConfidence: 100,
    reasonForDecision:
      "Escalated: Official authority warning from Deutscher Wetterdienst (DWD).",
    breakdown: {
      sourceReliability: 100,
      locationMatch: 100,
      mediaSupport: 0,
      crossSourceConfirmation: 100,
    },
    evidenceLinks: [
      {
        sourceType: "Weather Alert",
        title: "DWD: Official Warning for Heilbronn",
        time: minutesAgo(2),
        credibility: "high",
        href: "https://www.dwd.de",
      },
    ],
    signalSnippet:
      "WARNUNG vor STURMBÖEN (Level 2): Für Stadt Heilbronn treten Sturmböen mit Geschwindigkeiten bis 85 km/h...",
    signalSource: "DWD · Weather Alert",
  },
];

// Resolve all fallback '#' hrefs dynamically on load
for (const report of MOCK_REPORTS) {
  if (!report.externalUrl || report.externalUrl === "#") {
    report.externalUrl = getWorkingUrl(report.externalUrl, report.title, report.crisisType, report.signalSource);
  }
  for (const link of report.evidenceLinks) {
    if (!link.href || link.href === "#") {
      link.href = getWorkingUrl(link.href, link.title, link.sourceType);
    }
  }
}
