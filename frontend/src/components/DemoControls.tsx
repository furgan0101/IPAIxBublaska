"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Zap } from "lucide-react";

import { API_BASE, type SubmissionResult } from "@/lib/types";
import { INJECT_PRESETS, type InjectPreset } from "@/lib/presets";

interface DemoControlsProps {
  /** Called with the pipeline verdict after a successful injection. */
  onResult: (result: SubmissionResult) => void | Promise<void>;
  /** Called after a successful reset. */
  onReset: () => void | Promise<void>;
}

/** Floating scenario injector — drives the live part of the demo. */
export default function DemoControls({ onResult, onReset }: DemoControlsProps) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function inject(preset: InjectPreset): Promise<void> {
    setBusy(preset.key);
    setError(false);
    try {
      const payload: Record<string, unknown> = { ...preset.payload };
      if (preset.staleHours) {
        payload.exif_timestamp = new Date(
          Date.now() - preset.staleHours * 3_600_000,
        ).toISOString();
      }
      const res = await fetch(`${API_BASE}/api/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("bad status");
      await onResult((await res.json()) as SubmissionResult);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function reset(): Promise<void> {
    setBusy("reset");
    setError(false);
    try {
      const res = await fetch(`${API_BASE}/api/reset`, { method: "POST" });
      if (!res.ok) throw new Error("bad status");
      await onReset();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel-glass absolute bottom-4 left-4 z-[1000] w-72 rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5"
      >
        <Zap className="h-4 w-4 text-amber-400" aria-hidden />
        <span className="text-[11px] font-bold tracking-widest text-slate-200">
          SCENARIO INJECTOR
        </span>
        <ChevronDown
          aria-hidden
          className={`ml-auto h-4 w-4 text-slate-500 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <div className="space-y-1.5 px-3 pb-3">
          {INJECT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              disabled={busy !== null}
              onClick={() => void inject(preset)}
              className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
                preset.tone === "verify"
                  ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15"
                  : "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15"
              }`}
            >
              <span
                className={`block text-xs font-semibold ${
                  preset.tone === "verify" ? "text-emerald-300" : "text-amber-300"
                }`}
              >
                {busy === preset.key ? "Injecting…" : preset.label}
              </span>
              <span className="block text-[10px] leading-tight text-slate-400">
                {preset.blurb}
              </span>
            </button>
          ))}

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
              Injection failed — is the API running on :8000?
            </p>
          )}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void reset()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {busy === "reset" ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      )}
    </div>
  );
}
