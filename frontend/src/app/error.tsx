"use client";

import { useEffect } from "react";

/** Route error boundary: keeps a crash contained and offers a retry. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="cl-fade-in w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          CrisisLens
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The dashboard hit an unexpected error. Your data is safe; try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
