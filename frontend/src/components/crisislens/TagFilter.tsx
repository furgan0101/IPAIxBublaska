"use client";

import { EventIcon, eventMeta } from "@/lib/eventMeta";

export interface TagCount {
  tag: string;
  count: number;
}

export default function TagFilter({
  tags,
  active,
  onChange,
}: {
  tags: TagCount[];
  active: string | null;
  onChange: (tag: string | null) => void;
}) {
  if (tags.length === 0) return null;

  const chipBase =
    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer";
  const idle = "border-muted-foreground/20 bg-background text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/50";
  const activeStyle = "border-gold/60 bg-gold/15 text-gold";

  return (
    <div
      role="group"
      aria-label="Filter reports by event type"
      className="pointer-events-auto absolute left-4 top-4 z-[1000] flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-lg bg-background/80 px-2.5 py-2 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => onChange(null)}
        className={`${chipBase} ${active === null ? activeStyle : idle}`}
      >
        All
      </button>
      {tags.map(({ tag, count }) => {
        const meta = eventMeta(tag);
        const isActive = active === tag;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(isActive ? null : tag)}
            className={`${chipBase} ${isActive ? activeStyle : idle}`}
          >
            <EventIcon
              eventType={tag}
              className={`h-3.5 w-3.5 ${isActive ? "text-gold" : meta.color}`}
            />
            {meta.label}
            <span className="font-mono text-[10px] opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
