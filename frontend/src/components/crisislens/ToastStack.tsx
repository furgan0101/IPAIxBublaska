"use client";

import { CheckCircle2, Info, ShieldX, X } from "lucide-react";

export interface DashboardToast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
}

const KIND_META: Record<
  DashboardToast["kind"],
  { border: string; icon: typeof CheckCircle2; iconCls: string }
> = {
  success: {
    border: "border-emerald-600/40",
    icon: CheckCircle2,
    iconCls: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    border: "border-red-600/40",
    icon: ShieldX,
    iconCls: "text-red-600 dark:text-red-400",
  },
  info: {
    border: "border-border",
    icon: Info,
    iconCls: "text-muted-foreground",
  },
};

/** Lightweight notification stack (dispatch confirmations etc.). */
export default function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: DashboardToast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-16 z-[1200] flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const meta = KIND_META[toast.kind];
        const Icon = meta.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card p-3 shadow-lg ${meta.border}`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${meta.iconCls}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">
                {toast.title}
              </p>
              {toast.detail && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {toast.detail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
