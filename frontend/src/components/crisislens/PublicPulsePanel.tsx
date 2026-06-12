"use client";

import {
  ExternalLink,
  Minus,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import type {
  CityPulse,
  Narrative,
  NarrativeCredibility,
  NarrativeTrend,
} from "@/lib/mediaResponse";
import { timeAgo } from "@/lib/format";

const TREND_ICON: Record<NarrativeTrend, typeof TrendingUp> = {
  rising: TrendingUp,
  flat: Minus,
  falling: TrendingDown,
};

const CREDIBILITY_CHIP: Record<
  NarrativeCredibility,
  { label: string; icon: typeof ShieldCheck; cls: string }
> = {
  verified: {
    label: "Verified",
    icon: ShieldCheck,
    cls: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  unverified: {
    label: "Unverified",
    icon: ShieldQuestion,
    cls: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  debunked: {
    label: "DEBUNKED",
    icon: ShieldAlert,
    cls: "border-red-600/40 bg-red-600/10 font-bold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300",
  },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}

/* ------------------------------------------------------ volume chart */

const CHART_W = 240;
const CHART_H = 64;
const CHART_PAD = 4;

/** Hand-drawn SVG area chart of signal volume — no charting library. */
function VolumeChart({ pulse }: { pulse: CityPulse }) {
  const max = Math.max(...pulse.volume.map((p) => p.volume), 1);
  const x = (i: number): number =>
    (i / (pulse.volume.length - 1)) * CHART_W;
  const y = (v: number): number =>
    CHART_H - CHART_PAD - (v / max) * (CHART_H - 2 * CHART_PAD);

  const line = pulse.volume
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.volume).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;

  const peak = pulse.volume[pulse.peakIndex];
  const peakLeft = (pulse.peakIndex / (pulse.volume.length - 1)) * 100;
  const peakTop = (y(peak.volume) / CHART_H) * 100;

  return (
    <div>
      <div className="relative h-16 w-full">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`Signal volume over the last 6 hours, peaking at ${Math.round(peak.volume)} signals per 15 minutes`}
        >
          <line
            x1="0"
            y1={CHART_H - 0.5}
            x2={CHART_W}
            y2={CHART_H - 0.5}
            stroke="var(--border)"
            strokeWidth="1"
          />
          <path d={area} fill="var(--gold-fill)" fillOpacity="0.14" />
          <path
            d={line}
            fill="none"
            stroke="var(--gold)"
            strokeWidth="1.75"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Spike marker — drawn outside the stretched SVG so it stays round. */}
        <span
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center"
          style={{ left: `${peakLeft}%`, top: `${peakTop}%` }}
          aria-hidden
        >
          <span className="h-2 w-2 rounded-full border-2 border-background bg-red-600 dark:bg-red-500" />
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        <span>−6 h</span>
        <span>−3 h</span>
        <span>now</span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-600 align-middle dark:bg-red-500" />
        Spike: ~{Math.round(peak.volume)} signals / 15 min ·{" "}
        {peak.minutesAgo === 0 ? "now" : `${peak.minutesAgo} min ago`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------ sentiment bar */

const SENTIMENT_META = [
  { key: "calm", label: "Calm", cls: "bg-emerald-500" },
  { key: "concerned", label: "Concerned", cls: "bg-amber-500" },
  { key: "panic", label: "Panic", cls: "bg-red-600 dark:bg-red-500" },
] as const;

function SentimentBar({ pulse }: { pulse: CityPulse }) {
  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Public sentiment: ${pulse.sentiment.calm}% calm, ${pulse.sentiment.concerned}% concerned, ${pulse.sentiment.panic}% panic`}
      >
        {SENTIMENT_META.map(({ key, cls }) => (
          <span
            key={key}
            className={cls}
            style={{ width: `${pulse.sentiment[key]}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4">
        {SENTIMENT_META.map(({ key, label, cls }) => (
          <span
            key={key}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${cls}`} aria-hidden />
            {label}
            <span className="font-mono tabular-nums text-foreground">
              {pulse.sentiment[key]}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- panel */

interface PublicPulsePanelProps {
  pulse: CityPulse;
  /** Jump to the composer pre-filled to rebut this debunked narrative. */
  onCounter: (narrative: Narrative) => void;
}

/**
 * LISTEN — the aggregated public-pulse picture for the focused city:
 * signal volume, sentiment, trending narratives (with the disinformation
 * the system already caught surfaced loudly) and a representative feed.
 */
export default function PublicPulsePanel({ pulse, onCounter }: PublicPulsePanelProps) {
  return (
    <div className="cl-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
      <section>
        <div className="flex items-baseline justify-between">
          <SectionLabel>Signal volume · last 6 h</SectionLabel>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            ~{pulse.totalSignals} posts
          </span>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-card p-4">
          <VolumeChart pulse={pulse} />
        </div>
      </section>

      <section>
        <SectionLabel>Public sentiment</SectionLabel>
        <div className="mt-3 rounded-lg border border-border bg-card p-4">
          <SentimentBar pulse={pulse} />
        </div>
      </section>

      <section>
        <SectionLabel>Trending narratives ({pulse.narratives.length})</SectionLabel>
        <ul className="mt-3 space-y-2">
          {pulse.narratives.map((narrative) => {
            const chip = CREDIBILITY_CHIP[narrative.credibility];
            const TrendIcon = TREND_ICON[narrative.trend];
            const debunked = narrative.credibility === "debunked";
            return (
              <li
                key={narrative.id}
                className={`rounded-lg border bg-card p-3.5 ${
                  debunked
                    ? "border-red-600/30 dark:border-red-500/30"
                    : "border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <TrendIcon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      narrative.trend === "rising"
                        ? debunked
                          ? "text-red-600 dark:text-red-400"
                          : "text-gold"
                        : "text-muted-foreground"
                    }`}
                    aria-label={`Trend: ${narrative.trend}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                    {narrative.topic}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    ×{narrative.volume}
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  “{narrative.sample}”
                </p>

                <div className="mt-2.5 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}
                  >
                    <chip.icon className="h-3 w-3" aria-hidden />
                    {chip.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">
                    {narrative.source}
                  </span>
                  {debunked && (
                    <button
                      type="button"
                      onClick={() => onCounter(narrative)}
                      className="shrink-0 rounded-md border border-gold/40 bg-gold-fill/10 px-2.5 py-1 text-[11px] font-semibold text-gold transition-colors hover:bg-gold-fill/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Counter →
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <SectionLabel>Representative signals</SectionLabel>
        <ul className="mt-3 space-y-2">
          {pulse.snippets.map((snippet) => (
            <li key={snippet.id}>
              <a
                href={snippet.href}
                {...(snippet.href === "#"
                  ? { onClick: (e: React.MouseEvent) => e.preventDefault() }
                  : { target: "_blank", rel: "noopener noreferrer" })}
                className="group block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/60"
              >
                <p className="line-clamp-2 text-xs leading-relaxed text-foreground/90">
                  {snippet.text}
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="min-w-0 truncate">{snippet.attribution}</span>
                  <span className="ml-auto shrink-0 font-mono tabular-nums">
                    {timeAgo(snippet.timestamp)}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                </p>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Volume, sentiment and narrative clusters are AI-assisted estimates
        derived from open sources — advisory only, not ground truth.
      </p>
    </div>
  );
}
