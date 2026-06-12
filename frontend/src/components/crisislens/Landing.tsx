"use client";

import { ArrowRight, ScanEye } from "lucide-react";

interface LandingProps {
  exiting: boolean;
  onBegin: () => void;
}

/** Full-screen hero shown before the analysis dashboard. */
export default function Landing({ exiting, onBegin }: LandingProps) {
  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col overflow-hidden bg-night-950 transition-all duration-700 ease-in-out ${
        exiting ? "pointer-events-none scale-[1.03] opacity-0" : "opacity-100"
      }`}
    >
      {/* Background layers */}
      <div className="cl-grid-bg absolute inset-0" aria-hidden />
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(239,68,68,0.07), transparent 65%), radial-gradient(ellipse 90% 70% at 50% 50%, transparent 40%, rgba(2,4,10,0.9))",
        }}
      />

      {/* Radar sweep */}
      <div
        className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2"
        aria-hidden
      >
        <div className="relative h-[620px] w-[620px] rounded-full border border-night-700/60">
          <div className="absolute inset-[18%] rounded-full border border-night-700/50" />
          <div className="absolute inset-[36%] rounded-full border border-night-700/40" />
          <div className="absolute inset-[54%] rounded-full border border-night-700/30" />
          <div
            className="cl-sweep absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(239,68,68,0.14), transparent 70deg)",
            }}
          />
        </div>
      </div>

      {/* Corner HUD readouts */}
      <div className="relative flex items-start justify-between p-5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
        <span className="cl-rise" style={{ animationDelay: "0.1s" }}>
          VOST BW · Concept Demo
        </span>
        <span className="cl-rise" style={{ animationDelay: "0.2s" }}>
          SYS 0.1.0 · Mock Feed
        </span>
      </div>

      {/* Hero content */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <div
          className="cl-rise flex items-center gap-3"
          style={{ animationDelay: "0.15s" }}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10">
            <ScanEye className="h-6 w-6 text-red-400" />
          </span>
          <h1 className="font-display text-6xl font-semibold tracking-[0.08em] sm:text-7xl">
            CRISIS<span className="text-red-500">LENS</span>
          </h1>
        </div>

        <div
          className="cl-rise mt-6 h-px w-44 bg-gradient-to-r from-transparent via-red-500/60 to-transparent"
          style={{ animationDelay: "0.3s" }}
          aria-hidden
        />

        <p
          className="cl-rise mt-6 max-w-md text-base leading-relaxed text-slate-400"
          style={{ animationDelay: "0.4s" }}
        >
          AI-assisted crisis signal analysis for civil protection teams.
        </p>

        <button
          type="button"
          onClick={onBegin}
          className="cl-rise group mt-10 inline-flex items-center gap-2.5 rounded-md bg-red-600 px-8 py-3.5 text-sm font-semibold uppercase tracking-[0.18em] text-white shadow-[0_0_28px_rgba(239,68,68,0.35)] transition-all hover:bg-red-500 hover:shadow-[0_0_40px_rgba(239,68,68,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-night-950"
          style={{ animationDelay: "0.55s" }}
        >
          Begin Analysis
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>

        <p
          className="cl-rise mt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500"
          style={{ animationDelay: "0.7s" }}
        >
          Mock crisis dataset · Baden-Württemberg · Human-in-the-loop review
        </p>
      </div>

      {/* Footer disclaimer */}
      <div className="relative p-5 text-center">
        <p
          className="cl-rise text-[11px] text-slate-600"
          style={{ animationDelay: "0.85s" }}
        >
          Demonstration interface — not an operational warning system.
        </p>
      </div>
    </div>
  );
}
