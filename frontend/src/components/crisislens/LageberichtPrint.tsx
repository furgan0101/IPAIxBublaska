"use client";

import { useEffect, useState } from "react";

import { STATUS_META, type CrisisReport } from "@/lib/mockReports";
import { safeNewDate } from "@/lib/format";

/** Konstanz demo sector — fixed for the situation report header. */
const SECTOR = {
  label: "Konstanz, Baden-Württemberg",
  lat: 47.6603,
  lon: 9.1758,
};

function sopStatus(report: CrisisReport): string {
  const tasks = report.sopTasks ?? [];
  if (tasks.length === 0) return "—";
  const done = tasks.filter((t) => t.completed).length;
  const prefix = report.dispatched ? "Dispatched · " : "";
  return `${prefix}${done}/${tasks.length} tasks complete`;
}

function centroid(report: CrisisReport): string {
  const [lat, lon] = report.coordinates;
  return `${lat.toFixed(4)} N, ${lon.toFixed(4)} E`;
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return safeNewDate(iso).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Generation timestamp, refreshed right before the print dialog opens.
 * Null on SSR / first client render avoids a hydration mismatch (the document
 * is invisible until printed anyway). */
function useGeneratedAt(): string {
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  useEffect(() => {
    const update = (): void => setGeneratedAt(new Date());
    update();
    window.addEventListener("beforeprint", update);
    return () => window.removeEventListener("beforeprint", update);
  }, []);
  return generatedAt
    ? generatedAt.toLocaleString("de-DE", {
        dateStyle: "full",
        timeStyle: "short",
      })
    : "";
}

/**
 * Print-only document. Hidden on screen via the `.print-doc` rule in
 * globals.css; the `@media print` stylesheet hides the live dashboard and
 * renders this as a clean black-on-white paper document.
 *
 * Two modes, both off the same adapted `CrisisReport` data the dashboard
 * shows: a full sector "Lagebericht" (focus = null), or a single-incident
 * dossier (focus = one report) for downloading one crisis event.
 */
export default function LageberichtPrint({
  reports,
  focus,
}: {
  reports: CrisisReport[];
  focus: CrisisReport | null;
}) {
  const dateStr = useGeneratedAt();

  if (focus) {
    return <IncidentReport report={focus} dateStr={dateStr} />;
  }
  return <SectorReport reports={reports} dateStr={dateStr} />;
}

/* --------------------------------------------------- full sector Lagebericht */

function SectorReport({
  reports,
  dateStr,
}: {
  reports: CrisisReport[];
  dateStr: string;
}) {
  const active = reports.filter((r) => r.status !== "ignored");
  const debunked = reports.filter((r) => r.status === "ignored");
  const sourceCount = active.reduce(
    (sum, r) => sum + r.evidenceLinks.length,
    0,
  );

  return (
    <div className="print-doc">
      <header className="print-head">
        <h1>LAGEBERICHT — VOSTbw Situational Awareness Report</h1>
        <p className="print-sub">
          {dateStr ? `${dateStr} · ` : ""}Sector: {SECTOR.label} (
          {SECTOR.lat.toFixed(4)} N, {SECTOR.lon.toFixed(4)} E)
        </p>
      </header>

      <section className="print-section">
        <h2>1 · Key Metrics</h2>
        <div className="print-metrics">
          <div className="print-metric">
            <span className="print-metric-num">{active.length}</span>
            <span className="print-metric-label">Active incidents</span>
          </div>
          <div className="print-metric">
            <span className="print-metric-num">{sourceCount}</span>
            <span className="print-metric-label">Corroborating sources</span>
          </div>
          <div className="print-metric">
            <span className="print-metric-num">{debunked.length}</span>
            <span className="print-metric-label">Disinformation blocked</span>
          </div>
        </div>
      </section>

      <section className="print-section">
        <h2>2 · Active Incidents</h2>
        {active.length === 0 ? (
          <p className="print-empty">No active incidents in the current sector.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Centroid</th>
                <th>Severity</th>
                <th>Conf.</th>
                <th>SOP checklist</th>
                <th>Action hint</th>
              </tr>
            </thead>
            <tbody>
              {active.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    {r.crisisType}
                    {r.classified ? " (RESTRICTED)" : ""}
                  </td>
                  <td>{centroid(r)}</td>
                  <td>{r.riskLevel}</td>
                  <td>{r.confidence}%</td>
                  <td>{sopStatus(r)}</td>
                  <td>{r.actionHint ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="print-section">
        <h2>3 · Debunked Disinformation</h2>
        {debunked.length === 0 ? (
          <p className="print-empty">No disinformation flagged in this window.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Flagged claim</th>
                <th>Reason flagged</th>
              </tr>
            </thead>
            <tbody>
              {debunked.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.crisisType}</td>
                  <td>{r.signalSnippet}</td>
                  <td>{r.reasonForDecision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ReportFooter />
    </div>
  );
}

/* ----------------------------------------------- single-incident dossier PDF */

function IncidentReport({
  report,
  dateStr,
}: {
  report: CrisisReport;
  dateStr: string;
}) {
  const tasks = report.sopTasks ?? [];
  const classified = Boolean(report.classified);

  return (
    <div className="print-doc">
      <header className="print-head">
        <h1>EINSATZ-LAGEBERICHT — {report.crisisType}</h1>
        <p className="print-sub">
          {dateStr ? `${dateStr} · ` : ""}Incident {report.id} · Sector:{" "}
          {SECTOR.label}
        </p>
      </header>

      <section className="print-section">
        <h2>Incident Overview</h2>
        <table className="print-kv">
          <tbody>
            <tr>
              <th>Incident ID</th>
              <td>{report.id}</td>
            </tr>
            <tr>
              <th>Type</th>
              <td>
                {report.crisisType}
                {classified ? " (RESTRICTED — information discipline)" : ""}
              </td>
            </tr>
            <tr>
              <th>Status</th>
              <td>{STATUS_META[report.status].label}</td>
            </tr>
            <tr>
              <th>Severity</th>
              <td>{report.riskLevel}</td>
            </tr>
            <tr>
              <th>Confidence</th>
              <td>{report.confidence}%</td>
            </tr>
            <tr>
              <th>Location confidence</th>
              <td>{report.locationConfidence}%</td>
            </tr>
            <tr>
              <th>Centroid</th>
              <td>
                {centroid(report)} · {report.city}
              </td>
            </tr>
            <tr>
              <th>Last signal</th>
              <td>{stamp(report.timestamp)}</td>
            </tr>
            <tr>
              <th>Dispatched</th>
              <td>
                {report.dispatched
                  ? `Yes — handed to Leitstelle ${stamp(report.dispatchedAt)}`
                  : "No — not yet dispatched"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="print-section">
        <h2>Assessment</h2>
        <p className="print-para">{report.aiSummary}</p>
        <p className="print-para">
          <strong>Reason for decision: </strong>
          {report.reasonForDecision}
        </p>
      </section>

      <section className="print-section">
        <h2>Recommended Action</h2>
        <p className="print-para">{report.actionHint ?? "—"}</p>
      </section>

      {tasks.length > 0 && (
        <section className="print-section">
          <h2>SOP Action Checklist</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Task</th>
                <th>Agency</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.task}>
                  <td>{t.completed ? "[x] complete" : "[ ] open"}</td>
                  <td>{t.task}</td>
                  <td>{t.agency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="print-section">
        <h2>Evidence / Sources</h2>
        {classified ? (
          <p className="print-empty">
            Restricted — raw intelligence (sources, media) is available to
            Police Command only. Secure handoff initiated.
          </p>
        ) : report.evidenceLinks.length === 0 ? (
          <p className="print-empty">No corroborating sources recorded.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th>Source type</th>
                <th>Detail</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {report.evidenceLinks.map((e, i) => (
                <tr key={`${e.title}-${i}`}>
                  <td>{e.sourceType}</td>
                  <td>{e.title}</td>
                  <td>{stamp(e.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ReportFooter />
    </div>
  );
}

function ReportFooter() {
  return (
    <footer className="print-foot">
      Generated by CrisisLens · VOSTbw — AI-assisted situational awareness.
      Plausibility estimates are advisory only; operational response requires
      human confirmation.
    </footer>
  );
}
