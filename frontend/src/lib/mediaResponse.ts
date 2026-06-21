/**
 * Command Mode data layer.
 *
 * Derives the "public pulse" picture (signal volume, sentiment split,
 * trending narratives, representative snippets) for a focused city from the
 * reports already on the dashboard, and produces channel-, tone- and
 * language-aware draft statements for the Media Response Console.
 *
 * Everything here is deterministic — seeded from report ids — so re-renders,
 * theme switches and the 5 s poll loop never reshuffle the demo. No backend
 * changes, no network calls: this works fully on the offline mock feed.
 */

import { safeNewDate } from "@/lib/format";
import { getWorkingUrl } from "@/lib/urls";
import type { CrisisReport } from "@/lib/reportTypes";

/* ------------------------------------------------ deterministic noise */

/** FNV-1a 32-bit string hash — seeds the demo's pseudo-noise streams. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG over [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(options: readonly T[], variant: number): T {
  return options[((variant % options.length) + options.length) % options.length];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/* -------------------------------------------------------- public pulse */

/** Look-back window of the pulse chart, in minutes (6 h). */
export const PULSE_WINDOW_MIN = 360;
/** 15-minute bins across the window. */
const PULSE_BINS = 24;

export interface PulsePoint {
  /** Minutes before "now" at the bin centre (PULSE_WINDOW_MIN … 0). */
  minutesAgo: number;
  /** Estimated public signals (posts, articles, reports) in this bin. */
  volume: number;
}

/** Percentages, always summing to 100. */
export interface SentimentSplit {
  calm: number;
  concerned: number;
  panic: number;
}

export type NarrativeCredibility = "verified" | "unverified" | "debunked";
export type NarrativeTrend = "rising" | "flat" | "falling";

export interface Narrative {
  id: string;
  /** The report this cluster was derived from. */
  reportId: string;
  /** Short headline of what people are posting about. */
  topic: string;
  crisisType: string;
  /** Posts attributed to this cluster in the last 6 h. */
  volume: number;
  trend: NarrativeTrend;
  credibility: NarrativeCredibility;
  /** Representative quote from the cluster. */
  sample: string;
  /** Attribution line for the sample. */
  source: string;
}

export interface PulseSnippet {
  id: string;
  text: string;
  attribution: string;
  timestamp: string;
  href: string;
}

export interface CityPulse {
  city: string;
  /** Estimated public signals across the whole window. */
  totalSignals: number;
  /** ISO time of the earliest signal — drives the event clock. */
  firstSignalAt: string | null;
  volume: PulsePoint[];
  /** Index into `volume` of the spike bin. */
  peakIndex: number;
  sentiment: SentimentSplit;
  /** Sorted: highest volume first — disinformation tends to float up. */
  narratives: Narrative[];
  /** Reverse-chron representative posts/articles. */
  snippets: PulseSnippet[];
}

/** Earliest signal across reports and their evidence — event-clock zero. */
export function firstSignalAt(reports: CrisisReport[]): string | null {
  let earliest: number | null = null;
  for (const report of reports) {
    const stamps = [report.timestamp, ...report.evidenceLinks.map((e) => e.time)];
    for (const stamp of stamps) {
      const t = safeNewDate(stamp).getTime();
      if (!Number.isNaN(t) && (earliest === null || t < earliest)) earliest = t;
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

function narrativeVolume(report: CrisisReport): number {
  const rng = mulberry32(hash32(report.id));
  // Falsehood travels faster: debunked clusters get the loudest share.
  if (report.status === "ignored") return Math.round(34 + rng() * 52);
  if (report.status === "relevant") return Math.round(18 + rng() * 38);
  return Math.round(9 + rng() * 22);
}

function narrativeTrend(report: CrisisReport, now: number): NarrativeTrend {
  const ageMin = Math.max(0, (now - safeNewDate(report.timestamp).getTime()) / 60_000);
  // Rumours keep spreading after first sight; real events cool off sooner.
  const risingHorizon = report.status === "ignored" ? 60 : 25;
  if (ageMin < risingHorizon) return "rising";
  if (ageMin < 55) return "flat";
  return "falling";
}

const CREDIBILITY_BY_STATUS: Record<CrisisReport["status"], NarrativeCredibility> = {
  relevant: "verified",
  review: "unverified",
  ignored: "debunked",
};

/** Derive the full public-pulse snapshot for one city's reports. */
export function derivePulse(city: string, reports: CrisisReport[]): CityPulse {
  const now = Date.now();
  const baseRng = mulberry32(hash32(`${city}:${reports.map((r) => r.id).join(",")}`));

  const narratives: Narrative[] = reports
    .map((report) => ({
      id: `nar-${report.id}`,
      reportId: report.id,
      topic: report.title,
      crisisType: report.crisisType,
      volume: narrativeVolume(report),
      trend: narrativeTrend(report, now),
      credibility: CREDIBILITY_BY_STATUS[report.status],
      sample: truncate(report.signalSnippet, 130),
      source: report.signalSource,
    }))
    .sort((a, b) => b.volume - a.volume);

  // Volume curve: per-report bumps over a low noise floor, in 15-min bins.
  const bins = new Array<number>(PULSE_BINS).fill(0);
  for (let i = 0; i < PULSE_BINS; i += 1) bins[i] = baseRng() * 1.8;
  const bump = [1, 0.55, 0.25];
  for (const report of reports) {
    const ageMin = (now - safeNewDate(report.timestamp).getTime()) / 60_000;
    const centre = PULSE_BINS - 1 - Math.round((ageMin / PULSE_WINDOW_MIN) * (PULSE_BINS - 1));
    const amplitude = narrativeVolume(report) / 4;
    for (let d = -2; d <= 2; d += 1) {
      const at = centre + d;
      if (at >= 0 && at < PULSE_BINS) bins[at] += amplitude * bump[Math.abs(d)];
    }
  }

  let peakIndex = 0;
  for (let i = 1; i < PULSE_BINS; i += 1) if (bins[i] > bins[peakIndex]) peakIndex = i;

  const volume: PulsePoint[] = bins.map((v, i) => ({
    minutesAgo: Math.round(((PULSE_BINS - 1 - i) / (PULSE_BINS - 1)) * PULSE_WINDOW_MIN),
    volume: Math.round(v * 10) / 10,
  }));

  // Sentiment: weighted by what is actually on the board. Rumours drive
  // panic; verified high-risk events drive concern.
  let calm = 55;
  let concerned = 35;
  let panic = 10;
  for (const report of reports) {
    if (report.status === "ignored") {
      panic += 7;
      concerned += 3;
      calm -= 10;
    } else if (report.status === "relevant") {
      const heavy = report.riskLevel === "High";
      concerned += heavy ? 9 : 6;
      panic += heavy ? 4 : 1;
      calm -= heavy ? 13 : 7;
    } else {
      concerned += 4;
      calm -= 4;
    }
  }
  calm = Math.max(6, calm);
  panic = Math.max(3, panic);
  const total = calm + concerned + panic;
  const sentiment: SentimentSplit = {
    calm: Math.round((calm / total) * 100),
    concerned: Math.round((concerned / total) * 100),
    panic: Math.round((panic / total) * 100),
  };
  sentiment.calm = 100 - sentiment.concerned - sentiment.panic;

  const snippets: PulseSnippet[] = reports
    .flatMap((report) => [
      {
        id: `${report.id}-sig`,
        text: report.signalSnippet,
        attribution: report.signalSource,
        timestamp: report.timestamp,
        href: getWorkingUrl(report.externalUrl, report.signalSnippet, "", report.signalSource),
      },
      ...report.evidenceLinks.map((e, i) => ({
        id: `${report.id}-ev${i}`,
        text: e.title,
        attribution: e.sourceType,
        timestamp: e.time,
        href: getWorkingUrl(e.href, e.title, e.sourceType),
      })),
    ])
    .sort((a, b) => safeNewDate(b.timestamp).getTime() - safeNewDate(a.timestamp).getTime())
    .slice(0, 9);

  return {
    city,
    totalSignals: narratives.reduce((sum, n) => sum + n.volume, 0),
    firstSignalAt: firstSignalAt(reports),
    volume,
    peakIndex,
    sentiment,
    narratives,
    snippets,
  };
}

/* -------------------------------------------------- statement drafting */

export type StatementChannel = "press" | "social" | "warnapp" | "banner";
export type StatementTone = "reassuring" | "factual" | "urgent";
export type StatementLang = "de" | "en";
export type StatementStatus = "draft" | "review" | "approved" | "published";

export interface ChannelMeta {
  label: string;
  /** Hard character limit (null = none; `lengthGuide` applies instead). */
  charLimit: number | null;
  /** Comfortable target length for the channel. */
  lengthGuide: number;
  hint: string;
}

export const CHANNEL_META: Record<StatementChannel, ChannelMeta> = {
  press: {
    label: "Press release",
    charLimit: null,
    lengthGuide: 1200,
    hint: "Full statement for media distribution — drafted in DE and EN.",
  },
  social: {
    label: "X / Mastodon",
    charLimit: 500,
    lengthGuide: 420,
    hint: "Public post on the official city accounts.",
  },
  warnapp: {
    label: "Warn-app push",
    charLimit: 240,
    lengthGuide: 200,
    hint: "NINA-style civil-protection alert — short and directive.",
  },
  banner: {
    label: "Website banner",
    charLimit: 280,
    lengthGuide: 220,
    hint: "Pinned notice on the city website.",
  },
};

export const TONE_META: Record<StatementTone, { label: string; hint: string }> = {
  reassuring: { label: "Reassuring", hint: "Calm the public, prevent panic." },
  factual: { label: "Factual", hint: "Neutral, verified facts only." },
  urgent: { label: "Urgent", hint: "Directive — immediate protective action." },
};

/** Workflow stages in order, for the approval stepper. */
export const STATEMENT_STAGES: readonly StatementStatus[] = [
  "draft",
  "review",
  "approved",
  "published",
];

export const STAGE_LABELS: Record<StatementStatus, string> = {
  draft: "Draft",
  review: "Pending review",
  approved: "Approved",
  published: "Published",
};

export interface IssuedStatement {
  id: string;
  city: string;
  channel: StatementChannel;
  tone: StatementTone;
  lang: StatementLang;
  /** Primary statement text (DE for bilingual press releases). */
  text: string;
  /** EN companion text — bilingual press releases only. */
  textEn: string | null;
  /** Topic of the debunked narrative this statement counters, if any. */
  counteredTopic: string | null;
  status: StatementStatus;
  draftedAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  /** Audit trail. */
  author: string;
  reviewer: string | null;
  reach: { value: number; unit: string } | null;
}

/** Simulated distribution figures per channel — deterministic per city. */
export function simulatedReach(
  channel: StatementChannel,
  seed: string,
): { value: number; unit: string } {
  const h = hash32(`${channel}:${seed}`);
  switch (channel) {
    case "warnapp":
      return { value: 36_000 + (h % 140) * 100, unit: "devices reached" };
    case "social":
      return { value: 4_800 + (h % 96) * 100, unit: "impressions" };
    case "press":
      return { value: 5 + (h % 13), unit: "media pickups" };
    case "banner":
      return { value: 7_400 + (h % 68) * 100, unit: "page views / 24 h" };
  }
}

/* ----------------------------------------------------------- copy bank */

/** German labels for the event taxonomy used in the demo feeds. */
const EVENT_DE: Record<string, string> = {
  Fire: "Brand",
  Flooding: "Hochwasser",
  "Traffic Accident": "Verkehrsunfall",
  "Power Outage": "Stromausfall",
  "Storm Damage": "Sturmschäden",
  "Fallen Tree": "Umgestürzter Baum",
  "Explosion Rumour": "Explosionsgerücht",
  "Crowd Incident Rumour": "Gerücht über eine Massenpanik",
};

function eventLabel(crisisType: string, lang: StatementLang): string {
  return lang === "de" ? (EVENT_DE[crisisType] ?? crisisType) : crisisType;
}

function citySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-");
}

function clock(lang: StatementLang, iso?: string | null): string {
  const date = iso ? safeNewDate(iso) : new Date();
  return date.toLocaleTimeString(lang === "de" ? "de-DE" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const OPENINGS: Record<StatementLang, Record<StatementTone, readonly string[]>> = {
  de: {
    reassuring: [
      "Die Lage ist ernst, aber unter Kontrolle.",
      "Die zuständigen Einsatzkräfte haben die Lage im Griff.",
    ],
    factual: ["Zur aktuellen Lage informiert die Stadt:", "Lageinformation der Stadt:"],
    urgent: ["WICHTIGE WARNMELDUNG:", "ACHTUNG — aktuelle Gefahrenlage:"],
  },
  en: {
    reassuring: [
      "The situation is serious but under control.",
      "Emergency services have the situation well in hand.",
    ],
    factual: ["Update from the city:", "Situation update:"],
    urgent: ["IMPORTANT SAFETY NOTICE:", "ATTENTION — active incident:"],
  },
};

const INSTRUCTIONS: Record<StatementLang, Record<StatementTone, readonly string[]>> = {
  de: {
    reassuring: [
      "Es besteht kein Anlass zur Panik. Bitte informieren Sie sich ausschließlich über offizielle Kanäle.",
      "Bitte bewahren Sie Ruhe und folgen Sie den offiziellen Kanälen der Stadt für gesicherte Informationen.",
    ],
    factual: [
      "Weitere Informationen folgen, sobald gesicherte Erkenntnisse vorliegen.",
      "Das Lagezentrum bewertet die Lage fortlaufend; gesicherte Erkenntnisse werden umgehend veröffentlicht.",
    ],
    urgent: [
      "Meiden Sie den betroffenen Bereich, folgen Sie den Anweisungen der Einsatzkräfte und halten Sie Rettungswege frei.",
      "Meiden Sie den Bereich weiträumig und behindern Sie keine Einsatzkräfte.",
    ],
  },
  en: {
    reassuring: [
      "There is no cause for alarm. Please rely on official channels for information.",
      "Please remain calm and follow the official city channels for verified updates.",
    ],
    factual: [
      "Further updates will follow as verified information becomes available.",
      "The operations centre is continuously assessing the situation; verified findings will be published promptly.",
    ],
    urgent: [
      "Avoid the affected area, follow the instructions of emergency services and keep access routes clear.",
      "Stay well clear of the area and do not obstruct emergency operations.",
    ],
  },
};

export interface DraftInput {
  city: string;
  channel: StatementChannel;
  tone: StatementTone;
  lang: StatementLang;
  /** Debunked narrative to rebut — switches the draft into counter mode. */
  counter?: Narrative | null;
  /** City-scoped reports — facts for the draft are taken from these. */
  reports: CrisisReport[];
  /** Bumped by "Regenerate" to cycle phrasings. */
  variant: number;
}

/** Highest-confidence non-debunked report — the verified event to cite. */
function primaryEvent(reports: CrisisReport[]): CrisisReport | null {
  const active = reports
    .filter((r) => r.status !== "ignored")
    .sort((a, b) => b.confidence - a.confidence);
  return active[0] ?? null;
}

function coreLine(input: DraftInput, primary: CrisisReport | null): string {
  const { city, lang, counter, reports } = input;
  const since = clock(lang, firstSignalAt(reports));

  if (counter) {
    const claim = truncate(counter.sample, 110);
    const rebut =
      lang === "de"
        ? `In sozialen Medien kursiert derzeit die Behauptung: „${claim}“ Nach Prüfung durch das Lagezentrum ist diese Darstellung FALSCH. Das geteilte Material ist nicht aktuell bzw. stammt nicht aus ${city}. Bitte teilen Sie solche Inhalte nicht weiter.`
        : `A claim is currently circulating on social media: “${claim}” Following review by the emergency operations centre, this claim is FALSE. The shared material is not current and does not originate from ${city}. Please do not share it further.`;
    const reality = primary
      ? lang === "de"
        ? ` Zur tatsächlichen Lage: ${eventLabel(primary.crisisType, "de")} im Stadtgebiet — Einsatzkräfte sind vor Ort.`
        : ` On the actual situation: ${eventLabel(primary.crisisType, "en")} in the city area — emergency services are on scene.`
      : lang === "de"
        ? ` Im Stadtgebiet ${city} ist derzeit keine entsprechende Gefahrenlage bestätigt.`
        : ` No corresponding incident is currently confirmed in the ${city} city area.`;
    return rebut + reality;
  }

  if (!primary) {
    return lang === "de"
      ? `Dem Lagezentrum liegen derzeit keine bestätigten Schadenslagen im Stadtgebiet ${city} vor. Die offenen Kanäle werden fortlaufend beobachtet.`
      : `The emergency operations centre currently has no confirmed incidents in the ${city} city area. Open channels are being monitored continuously.`;
  }

  return lang === "de"
    ? `Dem Lagezentrum liegen seit ${since} Uhr mehrere unabhängige Meldungen zu folgendem Ereignis vor: ${eventLabel(primary.crisisType, "de")} im Stadtgebiet ${city}. Einsatzkräfte sind vor Ort.`
    : `Since ${since}, the emergency operations centre has received multiple independent reports of the following: ${eventLabel(primary.crisisType, "en")} in the ${city} city area. Emergency services are on scene.`;
}

/** One-sentence variant of the core for tight channels. */
function coreShort(input: DraftInput, primary: CrisisReport | null): string {
  const { city, lang, counter } = input;
  if (counter) {
    const claim = truncate(counter.sample, 70);
    return lang === "de"
      ? `Die kursierende Behauptung „${claim}“ ist FALSCH — geprüft durch das Lagezentrum ${city}.`
      : `The circulating claim “${claim}” is FALSE — verified by the ${city} emergency operations centre.`;
  }
  if (!primary) {
    return lang === "de"
      ? `Keine bestätigte Gefahrenlage in ${city} — die Lage wird fortlaufend beobachtet.`
      : `No confirmed incident in ${city} — the situation is being monitored continuously.`;
  }
  return lang === "de"
    ? `${eventLabel(primary.crisisType, "de")} in ${city}: Einsatzkräfte sind vor Ort, die Lage wird fortlaufend bewertet.`
    : `${eventLabel(primary.crisisType, "en")} in ${city}: emergency services are on scene, the situation is under continuous assessment.`;
}

/** Compose the AI-style draft for the selected channel / tone / language. */
export function draftStatement(input: DraftInput): string {
  const { city, channel, tone, lang, variant, reports, counter } = input;
  const primary = primaryEvent(reports);
  const opening = pick(OPENINGS[lang][tone], variant);
  const instruction = pick(INSTRUCTIONS[lang][tone], variant);
  const core = coreLine(input, primary);
  const short = coreShort(input, primary);
  const url = `${citySlug(city)}.de/lage`;
  const time = clock(lang);

  switch (channel) {
    case "press": {
      const header =
        lang === "de"
          ? `PRESSEMITTEILUNG — Stadt ${city} · Lagezentrum\nStand: ${time} Uhr`
          : `PRESS RELEASE — City of ${city} · Emergency Operations Centre\nAs of ${time}`;
      const detail =
        lang === "de"
          ? `Aktuell werden ${reports.length} Lagemeldungen geführt; die Bewertung erfolgt fortlaufend durch das Lagezentrum gemeinsam mit VOSTbw (digitale Lageaufklärung).`
          : `${reports.length} situation reports are currently being tracked; assessment is ongoing by the operations centre together with VOSTbw (digital situational awareness).`;
      const footer =
        lang === "de"
          ? `Offizielle Informationen: www.${url} · Warn-App NINA\nPressekontakt: Pressestelle der Stadt ${city} · presse@${citySlug(city)}.de`
          : `Official information: www.${url} · NINA warning app\nPress contact: City of ${city} press office · presse@${citySlug(city)}.de`;
      return `${header}\n\n${opening}\n\n${core}\n\n${detail}\n\n${instruction}\n\n${footer}`;
    }
    case "social": {
      const cityTag = city.replace(/\s+/g, "");
      const eventTag = (primary ? eventLabel(primary.crisisType, lang) : counter ? "Faktencheck" : "Lage")
        .replace(/[^A-Za-zÄÖÜäöüß0-9]/g, "");
      const info =
        lang === "de" ? `Offizielle Informationen: https://${url}` : `Official information: https://${url}`;
      return `${opening} ${short} ${instruction}\n\n${info}\n#${cityTag} #${eventTag}`;
    }
    case "warnapp": {
      const prefix =
        tone === "urgent"
          ? lang === "de" ? "WARNUNG" : "WARNING"
          : tone === "reassuring"
            ? lang === "de" ? "Hinweis" : "Notice"
            : lang === "de" ? "Lageinfo" : "Situation update";
      const mini = counter
        ? lang === "de"
          ? `Falschmeldung im Umlauf — „${truncate(counter.sample, 56)}“ ist nicht zutreffend.`
          : `False report circulating — “${truncate(counter.sample, 56)}” is not accurate.`
        : primary
          ? lang === "de"
            ? `${eventLabel(primary.crisisType, "de")} im Stadtgebiet.`
            : `${eventLabel(primary.crisisType, "en")} in the city area.`
          : lang === "de"
            ? "Keine bestätigte Gefahrenlage."
            : "No confirmed incident.";
      const act =
        tone === "urgent"
          ? lang === "de"
            ? "Bereich meiden, Anweisungen der Einsatzkräfte folgen."
            : "Avoid the area, follow instructions of emergency services."
          : tone === "reassuring"
            ? lang === "de"
              ? "Kein Grund zur Panik — bitte offizielle Kanäle nutzen."
              : "No cause for alarm — please use official channels."
            : lang === "de"
              ? "Informationen über offizielle Kanäle."
              : "Information via official channels.";
      const text = `${prefix} ${city}: ${mini} ${act} ${url}`;
      const limit = CHANNEL_META.warnapp.charLimit ?? 240;
      return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
    }
    case "banner": {
      const label =
        lang === "de" ? `Aktuelle Lage — Stand ${time} Uhr:` : `Current situation — as of ${time}:`;
      const text = `${label} ${short} ${instruction}`;
      const limit = CHANNEL_META.banner.charLimit ?? 280;
      return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
    }
  }
}
