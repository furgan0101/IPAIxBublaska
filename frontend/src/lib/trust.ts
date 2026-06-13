/**
 * Trust-level palette — the dashboard colours every signal by how trustworthy
 * it is (derived from the pipeline confidence / credibility score), instead of
 * by a triage verdict. There is deliberately no "escalated / needs review /
 * ignored" valuation: the colour says how much to trust the signal, and the
 * human decides what to do about it.
 */

export type TrustLevel = "high" | "medium" | "low";

export interface TrustMeta {
  level: TrustLevel;
  label: string;
  /** Hex used for map nodes / rings (works on both basemaps). */
  color: string;
  /** Tailwind classes for a badge/chip. */
  chip: string;
  /** Tailwind background for a status dot. */
  dot: string;
  /** Tailwind text colour. */
  text: string;
}

export const TRUST_META: Record<TrustLevel, TrustMeta> = {
  high: {
    level: "high",
    label: "High trust",
    color: "#10b981",
    chip: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  medium: {
    level: "medium",
    label: "Medium trust",
    color: "#f59e0b",
    chip: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
  },
  low: {
    level: "low",
    label: "Low trust",
    color: "#ef4444",
    chip: "border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
  },
};

/** All levels, most-trusted first — for legends. */
export const TRUST_LEVELS: TrustLevel[] = ["high", "medium", "low"];

/** Bucket a 0–100 confidence/credibility score into a trust level. */
export function trustLevel(confidence: number): TrustLevel {
  if (confidence >= 67) return "high";
  if (confidence >= 34) return "medium";
  return "low";
}

export function trustMeta(confidence: number): TrustMeta {
  return TRUST_META[trustLevel(confidence)];
}
