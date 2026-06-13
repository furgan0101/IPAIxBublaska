"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe2, Loader2, Search } from "lucide-react";

import type { SearchScope, SearchScopeGroup } from "@/lib/types";

interface ScopePickerProps {
  scopes: SearchScope[] | null;
  groups: SearchScopeGroup[] | null;
  activeScope: SearchScope | null;
  pending: boolean;
  error: string | null;
  onSelect: (id: string) => Promise<void>;
}

function groupScopes(scopes: SearchScope[]): SearchScopeGroup[] {
  const grouped = new Map<string, SearchScope[]>();
  for (const scope of scopes) {
    const next = grouped.get(scope.group) ?? [];
    next.push(scope);
    grouped.set(scope.group, next);
  }
  return Array.from(grouped, ([group, items]) => ({ group, items }));
}

export default function ScopePicker({
  scopes,
  groups,
  activeScope,
  pending,
  error,
  onSelect,
}: ScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const displayGroups = useMemo(() => {
    const source = groups ?? groupScopes(scopes ?? []);
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source
      .map((group) => ({
        group: group.group,
        items: group.items.filter((scope) => {
          const haystack = `${scope.label} ${scope.id} ${scope.group}`.toLowerCase();
          return haystack.includes(needle);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query, scopes]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activeLabel = activeScope?.label ?? "Konstanz Sector";
  const disabled = pending || (scopes?.length ?? 0) === 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select search scope"
        disabled={disabled}
        title={error ?? "Search scope"}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Globe2 className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
        <span className="min-w-0 truncate">{activeLabel}</span>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[1200] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          <label className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search scope"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>

          <div
            role="listbox"
            aria-label="Search scopes"
            className="cl-scroll max-h-[22rem] overflow-y-auto py-2"
          >
            {displayGroups.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No matching scopes
              </p>
            ) : (
              displayGroups.map((group) => (
                <div key={group.group} className="py-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {group.group}
                  </p>
                  {group.items.map((scope) => {
                    const selected = scope.id === activeScope?.id;
                    return (
                      <button
                        key={scope.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={async () => {
                          try {
                            await onSelect(scope.id);
                            setOpen(false);
                            setQuery("");
                          } catch {
                            // The hook exposes the error; keep the menu open.
                          }
                        }}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                          selected ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{scope.label}</span>
                        {selected && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
