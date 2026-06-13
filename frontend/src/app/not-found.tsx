import Link from "next/link";

/** Branded 404 page. */
export default function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="cl-fade-in text-center">
        <p className="font-display text-6xl font-bold text-gold">404</p>
        <h1 className="mt-2 font-display text-xl font-semibold text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That view does not exist in CrisisLens.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
