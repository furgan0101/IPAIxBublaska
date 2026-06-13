import { cn } from "@/lib/utils";

/** Baden-Württemberg flag mark: black over gold. */
export default function BwFlag({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Flag"
      className={cn(
        "inline-flex h-4 w-6 shrink-0 flex-col overflow-hidden rounded-[3px] ring-1 ring-border",
        className,
      )}
    >
      <span className="flex-1 bg-black" />
      <span className="flex-1 bg-gold-fill" />
    </span>
  );
}
