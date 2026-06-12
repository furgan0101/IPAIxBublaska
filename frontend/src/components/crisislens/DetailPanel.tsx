"use client";

import { useRef } from "react";
import {
  AtSign,
  Clock,
  CloudLightning,
  ExternalLink,
  MapPin,
  MessagesSquare,
  Newspaper,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";

import {
  STATUS_META,
  type Credibility,
  type CrisisReport,
  type SourceType,
} from "@/lib/mockReports";
import { timeAgo } from "@/lib/format";
import ConfidenceRing from "./ConfidenceRing";

const PANEL_WIDTH = 416;

const SOURCE_ICONS: Record<SourceType, typeof Newspaper> = {
  "Local News": Newspaper,
  "Social Media": AtSign,
  Forum: MessagesSquare,
  "Weather Alert": CloudLightning,
  "Citizen Report": UserRound,
};

const CREDIBILITY_META: Record<Credibility, { label: string; cls: string }> = {
  high: {
    label: "High",
    cls: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  medium: {
    label: "Med",
    cls: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  low: {
    label: "Low",
    cls: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
};

const RISK_CLS: Record<CrisisReport["riskLevel"], string> = {
  High: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
  Moderate:
    "border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  Low: "border-border bg-muted text-muted-foreground",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}

interface DetailPanelProps {
  report: CrisisReport | null;
  onClose: () => void;
}

/**
 * Right-hand report dossier. The wrapper animates its width so the map
 * column shrinks smoothly; the last report stays rendered while closing.
 */
export default function DetailPanel({ report, onClose }: DetailPanelProps) {
  const lastReport = useRef<CrisisReport | null>(null);
  if (report) lastReport.current = report;
  const shown = report ?? lastReport.current;

  return (
    <aside
      className="shrink-0 overflow-hidden transition-[width] duration-500 ease-in-out"
      style={{ width: report ? PANEL_WIDTH : 0 }}
      aria-hidden={!report}
    >
      <div
        className="flex h-full flex-col border-l border-border bg-background"
        style={{ width: PANEL_WIDTH }}
      >
        {shown && <PanelContent report={shown} onClose={onClose} />}
      </div>
    </aside>
  );
}

function PanelContent({
  report,
  onClose,
}: {
  report: CrisisReport;
  onClose: () => void;
}) {
  const meta = STATUS_META[report.status];
  const stamp = new Date(report.timestamp);

  return (
    <>
      {/* Header */}
      <div className="border-b border-border px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
              {report.crisisType}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}
            >
              {meta.badge}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report panel"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-4 font-display text-[26px] font-semibold leading-tight">
          {report.title}
        </h2>

        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <p className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {report.city}, Baden-Württemberg
            <span className="ml-auto font-mono text-[11px]">
              {report.coordinates[0].toFixed(4)} N ·{" "}
              {report.coordinates[1].toFixed(4)} E
            </span>
          </p>
          <p className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {timeAgo(report.timestamp)}
            <span className="ml-auto font-mono text-[11px]">
              {stamp.toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              local · {report.id}
            </span>
          </p>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="cl-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <section>
          <SectionLabel>AI-generated summary</SectionLabel>
          <p className="mt-2.5 rounded-lg border border-border bg-card p-4 text-[13px] leading-relaxed text-foreground/90">
            {report.aiSummary}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <SectionLabel>AI-assisted confidence</SectionLabel>
          <div className="mt-4">
            <ConfidenceRing
              key={report.id}
              value={report.confidence}
              color={meta.color}
              breakdown={[
                { label: "Source reliability", value: report.breakdown.sourceReliability },
                { label: "Location match", value: report.breakdown.locationMatch },
                { label: "Media support", value: report.breakdown.mediaSupport },
                { label: "Cross-source confirm.", value: report.breakdown.crossSourceConfirmation },
              ]}
            />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <SectionLabel>Risk level</SectionLabel>
            <span
              className={`mt-2.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${RISK_CLS[report.riskLevel]}`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {report.riskLevel}
            </span>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <SectionLabel>Location confidence</SectionLabel>
            <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-foreground">
              {report.locationConfidence}%
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/60"
                style={{ width: `${report.locationConfidence}%` }}
              />
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Reason for decision</SectionLabel>
          <p
            className="mt-2.5 rounded-r-lg border-l-2 bg-card px-4 py-3.5 text-[13px] leading-relaxed text-foreground/90"
            style={{ borderLeftColor: meta.color }}
          >
            {report.reasonForDecision}
          </p>
        </section>

        <section>
          <SectionLabel>Evidence ({report.evidenceLinks.length})</SectionLabel>
          <ul className="mt-2.5 space-y-2">
            {report.evidenceLinks.map((evidence) => {
              const Icon = SOURCE_ICONS[evidence.sourceType];
              const cred = CREDIBILITY_META[evidence.credibility];
              return (
                <li key={evidence.title}>
                  <a
                    href={evidence.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:bg-muted/60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {evidence.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {evidence.sourceType} · {timeAgo(evidence.time)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cred.cls}`}
                    >
                      {cred.label}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Footer disclaimer */}
      <div className="border-t border-border px-6 py-3.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Plausibility estimates are AI-assisted and advisory only. CrisisLens
          does not verify ground truth — escalation requires human
          confirmation.
        </p>
      </div>
    </>
  );
}
