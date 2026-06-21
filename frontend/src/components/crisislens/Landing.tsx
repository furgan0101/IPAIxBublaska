"use client";

import { ArrowRight, ScanSearch, UserCheck, RadioTower } from "lucide-react";

import { Button } from "@/components/ui/button";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";

interface LandingProps {
  exiting: boolean;
  onBegin: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

const STAGES = [
  {
    icon: <RadioTower className="h-5 w-5" />,
    badge: "Stage 01 · Ingest",
    title: "Open sources, one picture.",
    description:
      "Polls real open sources (official civil-protection and weather warnings from NINA and DWD, police & fire press releases, and public social posts) and normalises them into a single time-stamped feed.",
  },
  {
    icon: <ScanSearch className="h-5 w-5" />,
    badge: "Stage 02 · Triage",
    title: "Plausibility, not proclamation.",
    description:
      "Every report passes a credibility filter (bot-spam, recycled-media and geotag checks plus an optional AI analyst), then corroborating reports are clustered by location and time into verified incidents. Rejected reports are surfaced as caught disinformation, never silently deleted.",
  },
  {
    icon: <UserCheck className="h-5 w-5" />,
    badge: "Stage 03 · Review",
    title: "People decide. The system assists.",
    description:
      "Reviewers see the evidence, the confidence breakdown and the stated reason behind every machine suggestion. Escalation stays a human decision, evidence-based from end to end.",
  },
];

/** Full-screen entry view: hero, pipeline explainer, footer. */
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
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <BwFlag />
              <span className="font-display text-xl font-semibold tracking-[0.08em]">
                CRISISLENS
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:block">
                Hackathon demo
              </span>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-20 lg:pt-28">
          <p
            className="cl-rise font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
            style={{ animationDelay: "0.05s" }}
          >
            Civil protection
          </p>

          <div className="mt-6 flex flex-col justify-between gap-10 lg:flex-row lg:items-center">
            <h1
              className="cl-rise font-display text-7xl font-semibold leading-[0.95] tracking-tight sm:text-8xl"
              style={{ animationDelay: "0.15s" }}
            >
              Crisis<span className="text-gold">Lens</span>
            </h1>
            
            <div 
              className="cl-rise max-w-lg overflow-hidden rounded-xl border border-border bg-muted/30 shadow-2xl"
              style={{ animationDelay: "0.2s" }}
            >
              <img 
                src="/hero-map.png" 
                alt="Situational awareness map" 
                className="h-auto w-full object-cover grayscale invert dark:grayscale-0 dark:invert-0"
              />
            </div>
          </div>

          <p
            className="cl-rise mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground"
            style={{ animationDelay: "0.3s" }}
          >
            Crisis signal analysis for civil protection teams.
          </p>

          <div
            className="cl-rise mt-10 flex flex-wrap items-center gap-6"
            style={{ animationDelay: "0.45s" }}
          >
            <Button size="lg" onClick={onBegin} className="gap-2 font-semibold">
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
            Live open-source feeds · Human-in-the-loop review
          </p>
        </section>

        {/* Pipeline explainer: three stages, no imagery */}
        <section id="how-it-works" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                Human-in-the-loop pipeline
              </span>
              <h2 className="max-w-2xl font-display text-3xl font-semibold md:text-4xl">
                From raw signal to reviewed incident
              </h2>
              <p className="max-w-xl text-muted-foreground">
                Three stages. Every decision auditable, every escalation confirmed
                by a person.
              </p>
            </div>

            <ol className="mt-12 grid gap-5 lg:grid-cols-3">
              {STAGES.map((stage) => (
                <li
                  key={stage.badge}
                  className="flex flex-col gap-4 rounded-2xl border border-border bg-muted/30 p-6 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-gold">
                      {stage.icon}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {stage.badge}
                    </span>
                  </div>
                  <h3 className="font-display text-xl font-semibold">{stage.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {stage.description}
                  </p>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex justify-center">
              <Button size="lg" onClick={onBegin} className="gap-2 font-semibold">
                Open the dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Demonstration interface, not an operational warning system.
              {" "}IPAI × Public Makers × Komm.one hackathon · June 2026.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              SYS 0.2.0 · Live OSINT
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
