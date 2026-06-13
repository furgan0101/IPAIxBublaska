/** Route-level loading state: instant feedback during navigation or suspense. */
export default function Loading() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="cl-fade-in flex flex-col items-center gap-4">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-gold-fill" />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Loading CrisisLens
        </p>
      </div>
    </div>
  );
}
