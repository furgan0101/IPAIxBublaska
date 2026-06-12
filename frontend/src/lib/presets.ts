/** Canned report injections for the live demo. Each button POSTs `payload`
 *  (plus a computed `exif_timestamp` when `staleHours` is set) to
 *  POST /api/reports, then the dashboard refetches and reacts. */

export type InjectTone = "verify" | "debunk";

export interface InjectPreset {
  key: string;
  label: string;
  blurb: string;
  tone: InjectTone;
  /** When set, the handler stamps exif_timestamp = now - staleHours before POST. */
  staleHours?: number;
  payload: {
    source: string;
    author: string;
    text: string;
    event_type: string;
    lat: number;
    lon: number;
    exif_lat?: number;
    exif_lon?: number;
    media_url?: string;
  };
}

export const INJECT_PRESETS: InjectPreset[] = [
  {
    key: "corroborate",
    label: "Corroborating flood report",
    blurb: "Fresh & local → merges into the live flood incident, confidence rises",
    tone: "verify",
    payload: {
      source: "twitter",
      author: "@hafen_kn",
      text: "Wasser steht jetzt auch in der Tiefgarage am Hafen Konstanz, Stadtwerke vor Ort. #Hochwasser",
      event_type: "flood",
      lat: 47.6609,
      lon: 9.1786,
    },
  },
  {
    key: "new-sector",
    label: "New incident · north sector",
    blurb: "Credible but far from any cluster → a new red pin appears",
    tone: "verify",
    payload: {
      source: "telegram",
      author: "kn_warnkanal",
      text: "Sturmböen haben mehrere Bäume auf die Mainaustraße bei Litzelstetten geworfen, Straße blockiert.",
      event_type: "storm",
      lat: 47.6985,
      lon: 9.192,
    },
  },
  {
    key: "recycled",
    label: "Recycled-footage hoax",
    blurb: "Media EXIF is days old → caught by the temporal check",
    tone: "debunk",
    staleHours: 72,
    payload: {
      source: "telegram",
      author: "altvideo_kanal",
      text: "AKTUELLE Aufnahmen vom Hochwasser in Konstanz, gerade reingekommen!",
      event_type: "flood",
      lat: 47.6614,
      lon: 9.178,
      media_url: "https://video.example.net/archiv.mp4",
    },
  },
  {
    key: "botspam",
    label: "Bot-spam hoax",
    blurb: "Amplification phrasing → caught by the linguistic check",
    tone: "debunk",
    payload: {
      source: "telegram",
      author: "panik_news_de",
      text: "BREAKING!!! Staudamm bei Konstanz GEBROCHEN! SHARE BEFORE THEY DELETE THIS! t.me/panik_news",
      event_type: "flood",
      lat: 47.6588,
      lon: 9.1705,
    },
  },
];
