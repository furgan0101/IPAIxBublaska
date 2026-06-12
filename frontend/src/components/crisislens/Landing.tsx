"use client";

import { ArrowRight, ScanSearch, UserCheck, RadioTower } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Feature108 } from "@/components/ui/feature108";
import BwFlag from "./BwFlag";
import ThemeToggle from "./ThemeToggle";

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
        "CrisisLens collects public crisis signals — social posts, local news, weather alerts and citizen reports — and normalises them into a single time-stamped feed for Baden-Württemberg.",
      buttonText: "Begin Analysis",
      imageSrc:
        "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      imageAlt: "Earth at night seen from orbit, city lights visible",
    },
  },
  {
    value: "triage",
    icon: <ScanSearch className="h-auto w-4 shrink-0" />,
    label: "AI-assisted triage",
    content: {
      badge: "Stage 02 · Triage",
      title: "Plausibility, not proclamation.",
      description:
        "Every report receives an AI-assisted plausibility estimate built from source reliability, location match, media support and cross-source confirmation. Weak signals are ignored due to insufficient corroboration — never silently deleted.",
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
                VOST BW · Concept demo
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
            Baden-Württemberg · Civil protection
          </p>

          <h1
            className="cl-rise mt-6 font-display text-7xl font-semibold leading-[0.95] tracking-tight sm:text-8xl"
            style={{ animationDelay: "0.15s" }}
          >
            Crisis<span className="text-gold">Lens</span>
          </h1>

          <p
            className="cl-rise mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground"
            style={{ animationDelay: "0.3s" }}
          >
            AI-assisted crisis signal analysis for civil protection teams.
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
            Mock crisis dataset · Baden-Württemberg · Human-in-the-loop review
          </p>
        </section>

        {/* Pipeline explainer */}
        <div id="how-it-works" className="border-t border-border">
          <Feature108
            badge="Human-in-the-loop pipeline"
            heading="From raw signal to reviewed incident"
            description="Three stages. Every decision auditable, every escalation confirmed by a person."
            tabs={PIPELINE_TABS}
            onTabButtonClick={onBegin}
          />
        </div>

        {/* Footer */}
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Demonstration interface — not an operational warning system.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              SYS 0.1.0 · Mock feed
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
