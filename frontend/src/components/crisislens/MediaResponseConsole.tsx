"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BellRing,
  Check,
  ChevronLeft,
  Globe,
  Newspaper,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";

import type { CrisisReport } from "@/lib/mockReports";
import {
  CHANNEL_META,
  STAGE_LABELS,
  STATEMENT_STAGES,
  TONE_META,
  draftStatement,
  simulatedReach,
  type IssuedStatement,
  type Narrative,
  type StatementChannel,
  type StatementLang,
  type StatementStatus,
  type StatementTone,
} from "@/lib/mediaResponse";
import { timeAgo } from "@/lib/format";

const CHANNEL_ICONS: Record<StatementChannel, typeof Newspaper> = {
  press: Newspaper,
  social: AtSign,
  warnapp: BellRing,
  banner: Globe,
};

const CHANNELS = Object.keys(CHANNEL_META) as StatementChannel[];
const TONES = Object.keys(TONE_META) as StatementTone[];

/** Audit-trail roles shown in the workflow (demo personas). */
const DRAFT_AUTHOR = "Pressestelle · AI-assisted draft";
const REVIEWER = "Leitung Lagezentrum (OvD)";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  );
}

/* -------------------------------------------------------- char guide */

function CharGuide({ text, channel }: { text: string; channel: StatementChannel }) {
  const meta = CHANNEL_META[channel];
  const limit = meta.charLimit ?? meta.lengthGuide;
  const over = meta.charLimit !== null && text.length > meta.charLimit;
  const pct = Math.min(100, (text.length / limit) * 100);
  const barCls = over
    ? "bg-red-600 dark:bg-red-500"
    : pct > 90
      ? "bg-amber-500"
      : "bg-foreground/40";

  return (
    <div className="mt-1.5 flex items-center gap-3">
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={`shrink-0 font-mono text-[10px] tabular-nums ${
          over ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground"
        }`}
      >
        {text.length} / {meta.charLimit ?? `~${meta.lengthGuide}`}
      </span>
    </div>
  );
}

/* --------------------------------------------------- approval stepper */

function ApprovalStepper({ stage }: { stage: StatementStatus }) {
  const current = STATEMENT_STAGES.indexOf(stage);
  return (
    <ol className="flex items-center" aria-label="Approval workflow">
      {STATEMENT_STAGES.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center last:flex-none">
            <span className="flex min-w-0 flex-col items-center gap-1">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                  done
                    ? "border-gold bg-gold-fill text-black"
                    : active
                      ? "border-gold bg-background text-gold"
                      : "border-border bg-muted text-muted-foreground"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span
                className={`whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {STAGE_LABELS[step]}
              </span>
            </span>
            {i < STATEMENT_STAGES.length - 1 && (
              <span
                className={`mx-1.5 mb-4 h-px min-w-0 flex-1 ${done ? "bg-gold" : "bg-border"}`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------- response timeline */

function ResponseTimeline({ statements }: { statements: IssuedStatement[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (statements.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
        No communications issued for this event yet. Published statements will
        appear here as the official public record.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {statements.map((statement) => {
        const Icon = CHANNEL_ICONS[statement.channel];
        const isOpen = expanded.has(statement.id);
        return (
          <li
            key={statement.id}
            className="rounded-lg border border-border bg-card p-3.5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                {CHANNEL_META[statement.channel].label}
                {statement.textEn && " · DE + EN"}
              </span>
              <span className="shrink-0 rounded border border-emerald-600/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                Published
              </span>
            </div>

            {statement.counteredTopic && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-red-700 dark:text-red-400">
                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">
                  Counters: {statement.counteredTopic}
                </span>
              </p>
            )}

            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(statement.id)) next.delete(statement.id);
                  else next.add(statement.id);
                  return next;
                })
              }
              aria-expanded={isOpen}
              className="mt-2 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p
                className={`whitespace-pre-line text-xs leading-relaxed text-foreground/90 ${
                  isOpen ? "" : "line-clamp-3"
                }`}
              >
                {statement.text}
              </p>
              {isOpen && statement.textEn && (
                <p className="mt-2 whitespace-pre-line border-t border-border pt-2 text-xs leading-relaxed text-foreground/80">
                  {statement.textEn}
                </p>
              )}
            </button>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[10px] text-muted-foreground">
              <span className="font-mono tabular-nums">
                {statement.publishedAt ? timeAgo(statement.publishedAt) : "—"}
              </span>
              {statement.reach && (
                <span className="font-mono tabular-nums text-foreground/80">
                  {statement.reach.value.toLocaleString("de-DE")}{" "}
                  {statement.reach.unit}
                </span>
              )}
              <span className="ml-auto min-w-0 truncate">
                Approved: {statement.reviewer ?? "—"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------ console */

interface MediaResponseConsoleProps {
  city: string;
  /** City-scoped reports — the facts the drafts cite. */
  reports: CrisisReport[];
  /** Debunked narrative selected in the pulse panel, if any. */
  counter: Narrative | null;
  onClearCounter: () => void;
}

/**
 * RESPOND — the Media Response Console: AI-drafted official statements
 * (channel / tone / language aware), a draft → review → approve → publish
 * workflow with an audit trail, and the public response timeline.
 */
export default function MediaResponseConsole({
  city,
  reports,
  counter,
  onClearCounter,
}: MediaResponseConsoleProps) {
  const [channel, setChannel] = useState<StatementChannel>("press");
  const [tone, setTone] = useState<StatementTone>("factual");
  const [lang, setLang] = useState<StatementLang>("de");
  const [variant, setVariant] = useState(0);
  const [drafts, setDrafts] = useState<Record<StatementLang, string>>({
    de: "",
    en: "",
  });
  const [stage, setStage] = useState<StatementStatus>("draft");
  const [draftedAt, setDraftedAt] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [published, setPublished] = useState<IssuedStatement[]>([]);
  const idCounter = useRef(0);

  // Latest reports for draft generation, without re-drafting (and clobbering
  // manual edits) every time the 5 s poll returns a fresh array identity.
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const reportSignature = useMemo(
    () => reports.map((r) => r.id).join(","),
    [reports],
  );

  // Regenerate both language drafts whenever the inputs change — but never
  // while the statement is locked in review/approval.
  useEffect(() => {
    if (stage !== "draft") return;
    const base = {
      city,
      channel,
      tone,
      counter,
      reports: reportsRef.current,
      variant,
    };
    setDrafts({
      de: draftStatement({ ...base, lang: "de" }),
      en: draftStatement({ ...base, lang: "en" }),
    });
    // `reportSignature` stands in for `reports` to avoid re-drafting on
    // every poll-loop array identity change.
  }, [city, channel, tone, counter, variant, reportSignature, stage]);

  const bilingual = channel === "press";
  const locked = stage !== "draft";
  const overLimit = bilingual
    ? false
    : CHANNEL_META[channel].charLimit !== null &&
      drafts[lang].length > (CHANNEL_META[channel].charLimit ?? Infinity);

  const submitForReview = (): void => {
    setDraftedAt(new Date().toISOString());
    setStage("review");
  };

  const approve = (): void => {
    setApprovedAt(new Date().toISOString());
    setStage("approved");
  };

  const backToDraft = (): void => {
    setStage("draft");
    setDraftedAt(null);
    setApprovedAt(null);
  };

  const publish = (): void => {
    idCounter.current += 1;
    const id = `stmt-${idCounter.current}`;
    const nowIso = new Date().toISOString();
    setPublished((prev) => [
      {
        id,
        city,
        channel,
        tone,
        lang: bilingual ? "de" : lang,
        text: bilingual ? drafts.de : drafts[lang],
        textEn: bilingual ? drafts.en : null,
        counteredTopic: counter?.topic ?? null,
        status: "published",
        draftedAt: draftedAt ?? nowIso,
        approvedAt,
        publishedAt: nowIso,
        author: DRAFT_AUTHOR,
        reviewer: REVIEWER,
        reach: simulatedReach(channel, `${city}:${id}`),
      },
      ...prev,
    ]);
    // Reset the composer for the next statement; new variant = fresh draft.
    setStage("draft");
    setDraftedAt(null);
    setApprovedAt(null);
    setVariant((v) => v + 1);
    if (counter) onClearCounter();
  };

  const editorCls =
    "w-full resize-none rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:bg-muted/50 read-only:text-foreground/70";

  return (
    <div className="cl-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
      {/* ------------------------------------------------ composer setup */}
      <section>
        <SectionLabel>Statement composer</SectionLabel>

        {counter && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-600/30 bg-red-600/5 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/5">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-red-700 dark:text-red-300">
              Countering: {counter.topic}
            </p>
            <button
              type="button"
              onClick={onClearCounter}
              disabled={locked}
              aria-label="Stop countering this narrative"
              className="shrink-0 rounded p-0.5 text-red-700 transition-colors hover:bg-red-600/10 disabled:opacity-40 dark:text-red-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Channel */}
        <div className="mt-3 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Channel">
          {CHANNELS.map((key) => {
            const Icon = CHANNEL_ICONS[key];
            const active = channel === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => setChannel(key)}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                  active
                    ? "border-gold bg-gold-fill/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "text-gold" : ""}`} aria-hidden />
                <span className="truncate">{CHANNEL_META[key].label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
          {CHANNEL_META[channel].hint}
        </p>

        {/* Tone + language */}
        <div className="mt-3 flex items-center gap-1.5">
          <div className="flex flex-1 rounded-md border border-border bg-card p-0.5" role="radiogroup" aria-label="Tone preset">
            {TONES.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={tone === key}
                disabled={locked}
                onClick={() => setTone(key)}
                title={TONE_META[key].hint}
                className={`flex-1 rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                  tone === key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {TONE_META[key].label}
              </button>
            ))}
          </div>

          {bilingual ? (
            <span className="shrink-0 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              DE + EN
            </span>
          ) : (
            <div className="flex shrink-0 rounded-md border border-border bg-card p-0.5" role="radiogroup" aria-label="Language">
              {(["de", "en"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={lang === key}
                  disabled={locked}
                  onClick={() => setLang(key)}
                  className={`rounded px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    lang === key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {key.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------- editor */}
      <section>
        {bilingual ? (
          <div className="space-y-3">
            {(["de", "en"] as const).map((key) => (
              <div key={key}>
                <label
                  htmlFor={`draft-${key}`}
                  className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {key === "de" ? "Deutsch" : "English"}
                </label>
                <textarea
                  id={`draft-${key}`}
                  value={drafts[key]}
                  readOnly={locked}
                  rows={9}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className={editorCls}
                />
                <CharGuide text={drafts[key]} channel={channel} />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <textarea
              aria-label={`Draft statement (${lang === "de" ? "German" : "English"})`}
              value={drafts[lang]}
              readOnly={locked}
              rows={channel === "social" ? 7 : 5}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [lang]: e.target.value }))
              }
              className={editorCls}
            />
            <CharGuide text={drafts[lang]} channel={channel} />
          </div>
        )}

        {/* -------------------------------------------- workflow actions */}
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <ApprovalStepper stage={stage} />

          {(draftedAt || approvedAt) && (
            <div className="mt-3 space-y-1 border-t border-border pt-3 text-[10px] text-muted-foreground">
              {draftedAt && (
                <p>
                  Drafted by <span className="text-foreground/80">{DRAFT_AUTHOR}</span>{" "}
                  · {timeAgo(draftedAt)}
                </p>
              )}
              {approvedAt && (
                <p>
                  Approved by <span className="text-foreground/80">{REVIEWER}</span>{" "}
                  · {timeAgo(approvedAt)}
                </p>
              )}
            </div>
          )}

          <div className="mt-3.5 flex items-center gap-2">
            {stage === "draft" && (
              <>
                <button
                  type="button"
                  onClick={() => setVariant((v) => v + 1)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={submitForReview}
                  disabled={overLimit}
                  className="ml-auto flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  Submit for review
                </button>
              </>
            )}

            {stage === "review" && (
              <>
                <button
                  type="button"
                  onClick={backToDraft}
                  className="flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden />
                  Back to draft
                </button>
                <button
                  type="button"
                  onClick={approve}
                  className="ml-auto flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Check className="h-3 w-3" aria-hidden />
                  Approve
                </button>
              </>
            )}

            {stage === "approved" && (
              <>
                <button
                  type="button"
                  onClick={backToDraft}
                  className="flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden />
                  Back to draft
                </button>
                <button
                  type="button"
                  onClick={publish}
                  className="ml-auto flex items-center gap-1.5 rounded-md bg-gold-fill px-3 py-1.5 text-[11px] font-bold text-black transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Send className="h-3 w-3" aria-hidden />
                  Publish
                </button>
              </>
            )}
          </div>

          {overLimit && (
            <p className="mt-2 text-[10px] font-medium text-red-700 dark:text-red-400">
              Draft exceeds the {CHANNEL_META[channel].charLimit}-character
              limit for this channel — shorten it before review.
            </p>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------- timeline */}
      <section>
        <div className="flex items-baseline justify-between">
          <SectionLabel>Response timeline</SectionLabel>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {published.length} issued
          </span>
        </div>
        <div className="mt-3">
          <ResponseTimeline statements={published} />
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Drafts are AI-assisted and advisory only — every statement requires
        human review and approval before release.
      </p>
    </div>
  );
}
