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

const PANEL_WIDTH = 408;

const SOURCE_ICONS: Record<SourceType, typeof Newspaper> = {
  "Local News": Newspaper,
  "Social Media": AtSign,
  Forum: MessagesSquare,
  "Weather Alert": CloudLightning,
  "Citizen Report": UserRound,
};

const CREDIBILITY_META: Record<Credibility, { label: string; cls: string }> = {
  high: { label: "High", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  medium: { label: "Med", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  low: { label: "Low", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const RISK_CLS: Record<CrisisReport["riskLevel"], string> = {
  High: "border-red-500/40 bg-red-500/10 text-red-300",
  Moderate: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  Low: "border-slate-500/40 bg-slate-500/10 text-slate-300",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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
        className="flex h-full flex-col border-l border-night-700 bg-night-900"
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
      <div className="border-b border-night-700 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-night-600 bg-night-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              {report.crisisType}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.chip}`}
            >
              {meta.badge}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report panel"
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-night-700 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="font-display mt-3 text-2xl font-semibold leading-tight">
          {report.title}
        </h2>

        <div className="mt-3 space-y-1.5 text-xs text-slate-400">
          <p className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            {report.city}, Baden-Württemberg
            <span className="ml-auto font-mono text-[11px] text-slate-500">
              {report.coordinates[0].toFixed(4)} N ·{" "}
              {report.coordinates[1].toFixed(4)} E
            </span>
          </p>
          <p className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            {timeAgo(report.timestamp)}
            <span className="ml-auto font-mono text-[11px] text-slate-500">
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
      <div className="cl-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section>
          <SectionLabel>AI-generated summary</SectionLabel>
          <p className="mt-2 rounded-lg border border-night-700 bg-night-850 p-3.5 text-[13px] leading-relaxed text-slate-300">
            {report.aiSummary}
          </p>
        </section>

        <section className="rounded-lg border border-night-700 bg-night-850 p-4">
          <SectionLabel>AI-assisted confidence</SectionLabel>
          <div className="mt-3">
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
          <div className="rounded-lg border border-night-700 bg-night-850 p-3.5">
            <SectionLabel>Risk level</SectionLabel>
            <span
              className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${RISK_CLS[report.riskLevel]}`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {report.riskLevel}
            </span>
          </div>
          <div className="rounded-lg border border-night-700 bg-night-850 p-3.5">
            <SectionLabel>Location confidence</SectionLabel>
            <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-slate-100">
              {report.locationConfidence}%
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-night-700">
              <div
                className="h-full rounded-full bg-sky-400"
                style={{ width: `${report.locationConfidence}%` }}
              />
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Reason for decision</SectionLabel>
          <p
            className="mt-2 rounded-r-lg border-l-2 bg-night-850 px-3.5 py-3 text-[13px] leading-relaxed text-slate-300"
            style={{ borderLeftColor: meta.color }}
          >
            {report.reasonForDecision}
          </p>
        </section>

        <section>
          <SectionLabel>Evidence ({report.evidenceLinks.length})</SectionLabel>
          <ul className="mt-2 space-y-2">
            {report.evidenceLinks.map((evidence) => {
              const Icon = SOURCE_ICONS[evidence.sourceType];
              const cred = CREDIBILITY_META[evidence.credibility];
              return (
                <li key={evidence.title}>
                  <a
                    href={evidence.href}
                    onClick={(e) => e.preventDefault()}
                    className="group flex items-center gap-3 rounded-lg border border-night-700 bg-night-850 p-3 transition-colors hover:border-night-600 hover:bg-night-800"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-night-600 bg-night-800 text-slate-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-200 group-hover:text-white">
                        {evidence.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {evidence.sourceType} · {timeAgo(evidence.time)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cred.cls}`}
                    >
                      {cred.label}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-colors group-hover:text-slate-300" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Footer disclaimer */}
      <div className="border-t border-night-700 px-5 py-3">
        <p className="text-[11px] leading-relaxed text-slate-500">
          Plausibility estimates are AI-assisted and advisory only. CrisisLens
          does not verify ground truth — escalation requires human
          confirmation.
        </p>
      </div>
    </>
  );
}
