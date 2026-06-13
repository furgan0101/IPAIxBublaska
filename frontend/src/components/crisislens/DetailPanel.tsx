"use client";

import { useRef, useState } from "react";
import {
  AtSign,
  CheckCircle2,
  Clock,
  CloudLightning,
  ExternalLink,
  FileDown,
  ListChecks,
  Lock,
  MapPin,
  MessagesSquare,
  Newspaper,
  Send,
  ShieldAlert,
  UserRound,
  X,
  Share2,
} from "lucide-react";

import {
  type Credibility,
  type CrisisReport,
  type SourceType,
} from "@/lib/mockReports";
import { trustMeta } from "@/lib/trust";
import { safeNewDate, timeAgo } from "@/lib/format";
import ConfidenceRing from "./ConfidenceRing";

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

/** Colour-coded responder agency badges (BW conventions). */
const AGENCY_BADGE: Record<string, string> = {
  Feuerwehr: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
  Polizei: "border-blue-600/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  THW: "border-cyan-600/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  Rettungsdienst:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  LRA: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};
const AGENCY_BADGE_FALLBACK = "border-border bg-muted text-muted-foreground";

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
  /** Manual Leitstelle handoff; resolves true on success (enables the UI flip). */
  onDispatch?: (report: CrisisReport) => Promise<boolean>;
  /** Export this incident as a printable single-event PDF. */
  onExportPdf?: (report: CrisisReport) => void;
}

/**
 * Right-hand report dossier. The wrapper animates its width so the map
 * column shrinks smoothly; the last report stays rendered while closing.
 */
export default function DetailPanel({
  report,
  onClose,
  onDispatch,
  onExportPdf,
}: DetailPanelProps) {
  const lastReport = useRef<CrisisReport | null>(null);
  if (report) lastReport.current = report;
  const shown = report ?? lastReport.current;

  return (
    <aside
      className="shrink-0 overflow-hidden transition-[width] duration-500 ease-in-out"
      style={{ width: report ? "50%" : 0 }}
      aria-hidden={!report}
    >
      <div className="flex h-full w-full min-w-[360px] flex-col border-l border-border bg-background">
        {shown && (
          <PanelContent
            key={shown.id}
            report={shown}
            onClose={onClose}
            onDispatch={onDispatch}
            onExportPdf={onExportPdf}
          />
        )}
      </div>
    </aside>
  );
}

/**
 * SOP Action Checklist + Leitstelle dispatch. Checkbox ticks are local UI
 * state (responder's working notes); the dispatch handoff is server state
 * and completes the whole list. Remounts per incident via the parent key.
 */
function SopChecklist({
  report,
  onDispatch,
}: {
  report: CrisisReport;
  onDispatch?: (report: CrisisReport) => Promise<boolean>;
}) {
  const tasks = report.sopTasks ?? [];
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Optimistic flip so the badge appears before the next poll round-trip.
  const [localDispatchedAt, setLocalDispatchedAt] = useState<string | null>(null);

  const dispatched = Boolean(report.dispatched) || localDispatchedAt !== null;
  const dispatchedAt = report.dispatchedAt ?? localDispatchedAt;

  const handleDispatch = async (): Promise<void> => {
    if (!onDispatch || busy || dispatched) return;
    setBusy(true);
    try {
      if (await onDispatch(report)) {
        setLocalDispatchedAt(new Date().toISOString());
      }
    } finally {
      setBusy(false);
    }
  };

  if (tasks.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <SectionLabel>SOP action checklist</SectionLabel>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {tasks.map((task) => {
          const checked = dispatched || task.completed || Boolean(localDone[task.task]);
          return (
            <li key={task.task}>
              <label
                className={`flex items-start gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5 transition-colors ${
                  dispatched ? "" : "cursor-pointer hover:bg-muted/60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={dispatched}
                  onChange={() =>
                    setLocalDone((prev) => ({ ...prev, [task.task]: !checked }))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                />
                <span
                  className={`min-w-0 flex-1 text-[13px] leading-snug ${
                    checked
                      ? "text-muted-foreground line-through"
                      : "text-foreground/90"
                  }`}
                >
                  {task.task}
                </span>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                    AGENCY_BADGE[task.agency] ?? AGENCY_BADGE_FALLBACK
                  }`}
                >
                  {task.agency}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {dispatched ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          Dispatched to Control Center
          {dispatchedAt && (
            <span className="ml-auto font-mono text-[11px] font-normal tabular-nums">
              {safeNewDate(dispatchedAt).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              local
            </span>
          )}
        </div>
      ) : (
        onDispatch && (
          <button
            type="button"
            onClick={() => void handleDispatch()}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden />
            {busy ? "Dispatching…" : "Dispatch to Leitstelle"}
          </button>
        )
      )}
    </section>
  );
}

function PanelContent({
  report,
  onClose,
  onDispatch,
  onExportPdf,
}: {
  report: CrisisReport;
  onClose: () => void;
  onDispatch?: (report: CrisisReport) => Promise<boolean>;
  onExportPdf?: (report: CrisisReport) => void;
}) {
  const meta = trustMeta(report.confidence);
  const stamp = safeNewDate(report.timestamp);

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
              {meta.label}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onExportPdf && (
              <button
                type="button"
                onClick={() => onExportPdf(report)}
                title="Download this incident as a printable PDF"
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <FileDown className="h-3.5 w-3.5" />
                Export PDF
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report panel"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <h2 className="mt-4 font-display text-[26px] font-semibold leading-tight">
          {report.title}
        </h2>

        {!report.classified && report.externalUrl && (
          <a
            href={report.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-gold hover:underline"
          >
            Open original source
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          <p className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {report.city}
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
        {report.classified && (
          <section className="flex items-start gap-3 rounded-lg border border-red-600/40 bg-red-500/10 p-4">
            <Lock
              className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden
            />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-red-700 dark:text-red-300">
                Information discipline active
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">
                Raw intelligence is restricted. Secure handoff to Police
                Command initiated.
              </p>
            </div>
          </section>
        )}

        <section>
          <SectionLabel>AI-generated summary</SectionLabel>
          <p className="mt-2.5 rounded-lg border border-border bg-card p-4 text-[13px] leading-relaxed text-foreground/90">
            {report.aiSummary}
          </p>
        </section>

        {report.actionHint && (
          <section className="rounded-lg border border-gold/30 bg-gold/5 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 text-gold" />
              <SectionLabel>Recommended action</SectionLabel>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/90 font-medium italic">
              “{report.actionHint}”
            </p>
          </section>
        )}

        <section className="rounded-lg border border-border bg-card p-5">
          <SectionLabel>AI-assisted confidence</SectionLabel>
          <div className="mt-4">
            <ConfidenceRing
              key={report.id}
              value={report.confidence}
              color={meta.color}
              breakdown={[
                { label: "Source reliability", value: report.breakdown.sourceReliability },
                { label: "Media support", value: report.breakdown.mediaSupport },
                { label: "Cross-source confirm.", value: report.breakdown.crossSourceConfirmation },
              ]}
            />
          </div>
        </section>

        <section className="grid grid-cols-1">
          <div className="rounded-lg border border-border bg-card p-4">
            <SectionLabel>Risk level</SectionLabel>
            <span
              className={`mt-2.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${RISK_CLS[report.riskLevel]}`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {report.riskLevel}
            </span>
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

        {report.related_incidents && report.related_incidents.length > 0 && (
          <section className="rounded-lg border border-gold/30 bg-gold/5 p-4">
            <div className="flex items-center gap-2">
              <Share2 className="h-3.5 w-3.5 text-gold" />
              <SectionLabel>Connected incidents</SectionLabel>
            </div>
            <div className="mt-3 space-y-3">
              {report.related_incidents.map((rel) => (
                <div key={rel.incident_id} className="text-[13px] leading-relaxed">
                  <span className="font-bold text-gold uppercase text-[10px] block mb-1">
                    {rel.relation_type} relationship
                  </span>
                  <p className="text-foreground/90 italic">
                    “{rel.rationale}”
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {!report.classified &&
          ((report.mediaPreviews?.length ?? 0) > 0 || report.mediaConsistency) && (
          <section>
            <SectionLabel>Analyzed media</SectionLabel>
            {(report.mediaPreviews?.length ?? 0) > 0 && (
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {report.mediaPreviews?.map((src) => (
                  <a
                    key={src}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote OSINT hosts; next/image needs a domain allow-list */}
                    <img
                      src={src}
                      alt="Media analyzed by the AI for plausibility"
                      loading="lazy"
                      className="h-28 w-full object-cover"
                      onError={(e) => {
                        const wrapper = e.currentTarget.parentElement;
                        if (wrapper) wrapper.style.display = "none";
                      }}
                    />
                  </a>
                ))}
              </div>
            )}
            {report.mediaConsistency && (
              <p className="mt-2.5 rounded-lg border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-foreground/90">
                <span className="font-semibold">AI media check: </span>
                {report.mediaConsistency}
              </p>
            )}
          </section>
        )}

        {report.classified ? (
          <section>
            <SectionLabel>Evidence</SectionLabel>
            <p className="mt-2.5 flex items-center gap-2 rounded-lg border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Source feed restricted — raw reports and media are available to
              Police Command only.
            </p>
          </section>
        ) : (
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
                    {...(evidence.href === "#"
                      ? { onClick: (e: React.MouseEvent) => e.preventDefault() }
                      : { target: "_blank", rel: "noopener noreferrer" })}
                    className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:bg-muted/60"
                  >
                    {evidence.mediaPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote OSINT hosts
                      <img
                        src={evidence.mediaPreview}
                        alt=""
                        loading="lazy"
                        className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                    )}
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
        )}
      </div>

      {/* Footer disclaimer */}
      <div className="border-t border-border px-6 py-3.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Trust estimates are AI-assisted and advisory only. CrisisLens does
          not verify ground truth — any operational response requires human
          confirmation.
        </p>
      </div>
    </>
  );
}
