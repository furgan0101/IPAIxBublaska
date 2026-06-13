"use client";

import {
  ArrowRight,
  ScanSearch,
  UserCheck,
  RadioTower,
  ShieldCheck,
  Bot,
  History,
  MapPinOff,
  Layers,
  CircleDot,
  Newspaper,
  Hash,
  Crosshair,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Feature108 } from "@/components/ui/feature108";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";
import Reveal from "./Reveal";

interface LandingProps {
  exiting: boolean;
  onBegin: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

const PIPELINE_TABS = [
  {
    value: "ingest",
    icon: <RadioTower className="h-auto w-4 shrink-0" />,
    label: "Signal ingestion",
    content: {
      badge: "Stage 01 · Ingest",
      title: "Open sources, one picture.",
      description:
        "CrisisLens collects public crisis signals — social posts, local news, weather alerts and citizen reports — and normalises them into a single time-stamped feed.",
      buttonText: "Begin Analysis",
      imageSrc:
        "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Earth at night seen from orbit, city lights visible",
    },
  },
  {
    value: "triage",
    icon: <ScanSearch className="h-auto w-4 shrink-0" />,
    label: "Triage analysis",
    content: {
      badge: "Stage 02 · Triage",
      title: "Plausibility, not proclamation.",
      description:
        "Every report receives a plausibility estimate built from source reliability, location match, media support and cross-source confirmation. Weak signals are ignored due to insufficient corroboration — never silently deleted.",
      buttonText: "Open the dashboard",
      imageSrc:
        "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Topographic map with navigation instruments",
    },
  },
  {
    value: "review",
    icon: <UserCheck className="h-auto w-4 shrink-0" />,
    label: "Human review",
    content: {
      badge: "Stage 03 · Review",
      title: "People decide. The system assists.",
      description:
        "Escalation always requires a human decision. Reviewers see the evidence, the confidence breakdown and the stated reason behind every machine suggestion — evidence-based escalation, end to end.",
      buttonText: "Start reviewing",
      imageSrc:
        "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Team working together in front of monitors",
    },
  },
];

/** Headline capability figures — concrete numbers from the verification pipeline. */
const STATS = [
  { value: "27", unit: "classes", label: "BW crisis catalogue" },
  { value: "1.0", unit: "km", label: "Spatial cluster radius" },
  { value: "60", unit: "min", label: "Temporal match window" },
  { value: "3", unit: "stages", label: "Human-confirmed pipeline" },
];

/** Evidence the credibility filter weighs up before promoting a report. */
const VERIFIED_SIGNALS = [
  {
    icon: <Layers className="h-4 w-4" />,
    title: "Cross-source confirmation",
    body: "Independent reports of the same event type, clustered within 1.0 km and 60 minutes, reinforce each other.",
  },
  {
    icon: <Crosshair className="h-4 w-4" />,
    title: "Location match",
    body: "Claimed position is checked against the Konstanz gazetteer and the media's own geotag.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: "Plausible tone & media",
    body: "An optional vision analyst judges whether the imagery and language fit the reported incident.",
  },
];

/** The deterministic disinformation markers that get a report debunked. */
const DEBUNK_SIGNALS = [
  {
    icon: <Bot className="h-4 w-4" />,
    title: "Bot-spam markers",
    body: "Templated phrasing, burst posting and amplification patterns typical of coordinated noise.",
  },
  {
    icon: <History className="h-4 w-4" />,
    title: "Recycled footage",
    body: "EXIF capture time far older than the post — the classic stale flood / fire video pattern.",
  },
  {
    icon: <MapPinOff className="h-4 w-4" />,
    title: "Geotag drift",
    body: "Media geotagged far from the claimed location, contradicting where the event supposedly happened.",
  },
];

/** Keyless, real open-data connectors behind the live feed. */
const SOURCES = [
  { icon: <ShieldCheck className="h-4 w-4" />, name: "NINA", note: "Civil-protection warnings" },
  { icon: <Newspaper className="h-4 w-4" />, name: "Presseportal", note: "Police press RSS" },
  { icon: <Hash className="h-4 w-4" />, name: "Mastodon", note: "Hashtag monitoring" },
];

/** Full-screen entry view: hero, capability strip, verification, pipeline, footer. */
export default function Landing({
  exiting,
  onBegin,
  theme,
  onToggleTheme,
}: LandingProps) {
  return (
    <div
      className={`absolute inset-0 z-50 bg-background transition-opacity duration-700 ease-in-out ${
        exiting ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="cl-scroll h-full overflow-y-auto">
        {/* Flag rule across the top edge. */}
        <div className="flex h-1.5 flex-col" aria-hidden>
          <div className="flex-1 bg-black" />
          <div className="flex-1 bg-gold-fill" />
        </div>

        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <BwFlag />
              <span className="font-display text-xl font-semibold tracking-[0.08em]">
                CRISISLENS
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:block">
                Concept demo
              </span>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            className="pointer-events-none absolute inset-0 cl-dotgrid opacity-60"
            aria-hidden
          />
          <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-20 lg:pt-28">
            <p
              className="cl-rise inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
              style={{ animationDelay: "0.05s" }}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-fill" />
              Civil protection · Baden-Württemberg
            </p>

            <div className="mt-6 flex flex-col justify-between gap-10 lg:flex-row lg:items-center">
              <div className="max-w-xl">
                <h1
                  className="cl-rise font-display text-7xl font-semibold leading-[0.95] tracking-tight sm:text-8xl"
                  style={{ animationDelay: "0.15s" }}
                >
                  Crisis<span className="text-gold">Lens</span>
                </h1>

                <p
                  className="cl-rise mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground"
                  style={{ animationDelay: "0.3s" }}
                >
                  An AI credibility filter that separates real incidents from
                  disinformation, verifies them in time and space, and plots the
                  result on a live situational map.
                </p>

                <div
                  className="cl-rise mt-10 flex flex-wrap items-center gap-6"
                  style={{ animationDelay: "0.45s" }}
                >
                  <Button
                    size="lg"
                    onClick={onBegin}
                    className="gap-2 font-semibold"
                  >
                    Begin Analysis
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <a
                    href="#how-it-works"
                    className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    How it works
                  </a>
                </div>

                <p
                  className="cl-rise mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                  style={{ animationDelay: "0.6s" }}
                >
                  Demo sector: Konstanz · Human-in-the-loop review
                </p>
              </div>

              <div
                className="cl-rise w-full max-w-lg overflow-hidden rounded-xl border border-border bg-muted/30 shadow-2xl"
                style={{ animationDelay: "0.2s" }}
              >
                <img
                  src="/hero-map.png"
                  alt="Situational awareness map"
                  className="h-auto w-full object-cover grayscale invert dark:grayscale-0 dark:invert-0"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Capability stat strip */}
        <Reveal>
          <section className="border-b border-border">
            <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
              {STATS.map((stat) => (
                <div key={stat.label} className="px-6 py-8">
                  <p className="font-display text-4xl font-semibold tracking-tight">
                    {stat.value}
                    <span className="ml-1 text-base font-medium text-muted-foreground">
                      {stat.unit}
                    </span>
                  </p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* Signal vs. noise — the credibility filter */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                The credibility filter
              </p>
              <h2 className="mt-4 max-w-2xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                Separating real incidents from{" "}
                <span className="text-gold">disinformation</span>.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                Deterministic heuristics run first on every report — a vision
                analyst weighs in on top. Corroborated signals rise; the classic
                disinformation patterns are caught and shown, never silently
                dropped.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              {/* Verified column */}
              <Reveal>
                <div className="h-full rounded-2xl border border-border bg-muted/30 p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-fill text-black">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        Promoted
                      </p>
                      <h3 className="font-display text-xl font-semibold">
                        Verified incident
                      </h3>
                    </div>
                  </div>
                  <ul className="mt-7 space-y-6">
                    {VERIFIED_SIGNALS.map((item) => (
                      <li key={item.title} className="flex gap-4">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-gold">
                          {item.icon}
                        </span>
                        <div>
                          <p className="font-semibold">{item.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {item.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>

              {/* Debunked column */}
              <Reveal delay={0.08}>
                <div className="h-full rounded-2xl border border-border bg-muted/30 p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500">
                      <CircleDot className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        Flagged
                      </p>
                      <h3 className="font-display text-xl font-semibold">
                        Disinformation caught
                      </h3>
                    </div>
                  </div>
                  <ul className="mt-7 space-y-6">
                    {DEBUNK_SIGNALS.map((item) => (
                      <li key={item.title} className="flex gap-4">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/30 text-amber-500">
                          {item.icon}
                        </span>
                        <div>
                          <p className="font-semibold">{item.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {item.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Pipeline explainer */}
        <div id="how-it-works" className="border-b border-border">
          <Feature108
            badge="Human-in-the-loop pipeline"
            heading="From raw signal to reviewed incident"
            description="Three stages. Every decision auditable, every escalation confirmed by a person."
            tabs={PIPELINE_TABS}
            onTabButtonClick={onBegin}
          />
        </div>

        {/* Open-data sources */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <Reveal>
              <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-md">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Built on open data
                  </p>
                  <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
                    Keyless, real-world connectors.
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Live mode flows the same public sources through the
                    credibility filter — no API keys, no scraping behind logins.
                  </p>
                </div>
                <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
                  {SOURCES.map((source) => (
                    <div
                      key={source.name}
                      className="rounded-xl border border-border bg-muted/30 px-4 py-4"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-gold">
                        {source.icon}
                      </span>
                      <p className="mt-3 font-semibold">{source.name}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {source.note}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            className="pointer-events-none absolute inset-0 cl-dotgrid opacity-40"
            aria-hidden
          />
          <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
            <Reveal>
              <h2 className="mx-auto max-w-2xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                See the situation before the noise does.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Step into the live Konstanz board — verified incidents, debunked
                hoaxes and responder guidance, side by side.
              </p>
              <div className="mt-9 flex justify-center">
                <Button
                  size="lg"
                  onClick={onBegin}
                  className="gap-2 font-semibold"
                >
                  Begin Analysis
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </Reveal>
          </div>
          {/* Black/gold caution rule */}
          <div className="cl-hazard h-2" aria-hidden />
        </section>

        {/* Footer */}
        <footer>
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BwFlag />
              <p className="text-xs text-muted-foreground">
                Demonstration interface — not an operational warning system.
              </p>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              SYS 0.1.0 · Mock feed
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
