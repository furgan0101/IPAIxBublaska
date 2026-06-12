"use client";

import { useEffect, useState } from "react";
import { Crosshair, LogOut, ShieldAlert } from "lucide-react";

import type { RiskLevel } from "@/lib/mockReports";
import { safeNewDate } from "@/lib/format";

const RISK_CHIP: Record<RiskLevel, string> = {
  High: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
  Moderate:
    "border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  Low: "border-border bg-muted text-muted-foreground",
};

/** Format an elapsed duration as T+ HH:MM:SS. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `T+ ${pad(h)}:${pad(m)}:${pad(s)}`;
}

interface CommandBannerProps {
  city: string;
  /** ISO time of the earliest signal — event-clock zero. */
  firstSignal: string | null;
  reportCount: number;
  highestRisk: RiskLevel | null;
  onExit: () => void;
}

/**
 * Command Mode header strip: gold/black civil-protection identity, the city
 * in focus, a live event clock since the first signal, and the exit control.
 */
export default function CommandBanner({
  city,
  firstSignal,
  reportCount,
  highestRisk,
  onExit,
}: CommandBannerProps) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const zero = firstSignal ? safeNewDate(firstSignal).getTime() : null;

  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="flex h-12 items-stretch">
        {/* Gold identity block — the one loud element in the app. */}
        <div className="flex items-center gap-2 bg-gold-fill px-4 text-black">
          <Crosshair className="h-4 w-4" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em]">
            Command Mode
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-4 px-5">
          <h2 className="truncate font-display text-lg font-semibold tracking-[0.04em]">
            {city}
          </h2>

          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />

          <div className="hidden items-baseline gap-2 sm:flex">
            <span
              className="font-mono text-sm font-semibold tabular-nums text-foreground"
              title="Time since the first signal of this event"
            >
              {zero ? formatElapsed(now - zero) : "T+ —"}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              since first signal
              {zero && (
                <>
                  {" · "}
                  {new Date(zero).toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              )}
            </span>
          </div>

          <span className="hidden h-5 w-px bg-border md:block" aria-hidden />

          <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground md:block">
            {reportCount} tracked report{reportCount === 1 ? "" : "s"}
          </span>

          {highestRisk && (
            <span
              className={`hidden items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] md:inline-flex ${RISK_CHIP[highestRisk]}`}
            >
              <ShieldAlert className="h-3 w-3" aria-hidden />
              {highestRisk} risk
            </span>
          )}

          <button
            type="button"
            onClick={onExit}
            className="ml-auto flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Exit Command Mode
            <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground lg:inline">
              Esc
            </kbd>
          </button>
        </div>
      </div>

      {/* Civil-protection caution stripe — Command Mode's signature rule. */}
      <div className="cl-hazard h-[3px]" aria-hidden />
    </div>
  );
}
