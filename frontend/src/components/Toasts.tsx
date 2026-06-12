"use client";

import { CheckCircle2, Info, ShieldX, X } from "lucide-react";

export interface Toast {
  id: number;
  kind: "verified" | "debunked" | "info";
  title: string;
  detail?: string;
}

const KIND_STYLE: Record<Toast["kind"], string> = {
  verified: "border-emerald-500/50",
  debunked: "border-amber-500/50",
  info: "border-cyan-500/50",
};

function ToastIcon({ kind }: { kind: Toast["kind"] }) {
  if (kind === "verified")
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />;
  if (kind === "debunked")
    return <ShieldX className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />;
  return <Info className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden />;
}

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute right-4 top-4 z-[1100] flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`panel-glass animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 ${KIND_STYLE[toast.kind]}`}
        >
          <ToastIcon kind={toast.kind} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-100">{toast.title}</p>
            {toast.detail && (
              <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
                {toast.detail}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="rounded p-0.5 text-slate-500 transition-colors hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
