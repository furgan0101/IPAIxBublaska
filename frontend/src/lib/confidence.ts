/**
 * Confidence scoring + colour ramp for incident pins.
 *
 * Pure, dependency-free helpers shared by the live adapter (display value) and
 * the map (pin colour + opacity). The blend deliberately produces a WIDE
 * spread so a lone unverified post lands near 5-20 and several corroborating
 * official sources reach 90-99, instead of everything clustering high.
 */

export type ConfidenceBand =
  | "very-low"
  | "low"
  | "medium"
  | "high"
  | "very-high";

/** Distinct colours, slate (barely credible) up to deep red (confirmed). */
export const BAND_COLORS: Record<ConfidenceBand, string> = {
  "very-low": "#64748b",
  low: "#f59e0b",
  medium: "#f97316",
  high: "#ef4444",
  "very-high": "#b91c1c",
};

/** Short human label per band, for tooltips/legends. */
export const BAND_LABELS: Record<ConfidenceBand, string> = {
  "very-low": "Very low",
  low: "Low",
  medium: "Medium",
  high: "High",
  "very-high": "Very high",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface ConfidenceInputs {
  verdict: "verified" | "debunked";
  /** Corroboration confidence_score from the backend (0..1). */
  corroboration?: number;
  /** Number of independent reports in the cluster. */
  reportCount?: number;
  /** How many of those came from official channels (NINA, police, fire). */
  officialCount?: number;
  /** Credibility score for a debunked report (0..1). */
  credibility?: number;
}

/**
 * Blend the available signals into a 0..100 confidence with real variety.
 * Debunked reports map low (1..20); verified reports range from a lone,
 * unofficial single source (about 5..20) to multiple official sources (90..99).
 */
export function blendConfidence(inputs: ConfidenceInputs): number {
  if (inputs.verdict === "debunked") {
    const credibility = inputs.credibility ?? 0.1;
    return clamp(Math.round(credibility * 100), 1, 20);
  }
  const reportCount = Math.max(1, inputs.reportCount ?? 1);
  const officialCount = Math.max(0, inputs.officialCount ?? 0);
  const corroboration = inputs.corroboration ?? 0.5;

  let score = 28 + officialCount * 24 + (reportCount - 1) * 13;
  if (corroboration >= 0.9) score += 6;
  if (officialCount === 0 && reportCount === 1) score -= 16;
  return clamp(Math.round(score), 3, 99);
}

export function confidenceBand(pct: number): ConfidenceBand {
  if (pct >= 85) return "very-high";
  if (pct >= 65) return "high";
  if (pct >= 45) return "medium";
  if (pct >= 25) return "low";
  return "very-low";
}

export function confidenceColor(pct: number): string {
  return BAND_COLORS[confidenceBand(pct)];
}

export function confidenceLabel(pct: number): string {
  return BAND_LABELS[confidenceBand(pct)];
}

/** Fainter pins for low confidence: 0.55 at 0 percent, 1.0 at 100 percent. */
export function confidenceOpacity(pct: number): number {
  return Math.round((0.55 + 0.45 * (clamp(pct, 0, 100) / 100)) * 100) / 100;
}
