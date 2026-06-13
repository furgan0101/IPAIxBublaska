"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";

import { suggestCities, type CityHit } from "@/lib/cityGazetteer";

interface CityTypeaheadProps {
  /** Currently selected region label (shown when the input is blurred/empty). */
  selectedName: string | null;
  onSelect: (hit: CityHit) => void;
  onClear: () => void;
}

/**
 * Compact city / Landkreis autocomplete for the filter toolbar. Suggestions
 * come from the offline gazetteer (zero network). Enter selects the first
 * suggestion; click selects any; ↑/↓ move the active option.
 */
export default function CityTypeahead({
  selectedName,
  onSelect,
  onClear,
}: CityTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const suggestions = useMemo(
    () => (query.trim() ? suggestCities(query, 6) : []),
    [query],
  );

  // Clamp the active index whenever the suggestion list changes.
  useEffect(() => setActive(0), [query]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (hit: CityHit): void => {
    onSelect(hit);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(suggestions[active] ?? suggestions[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          placeholder={selectedName ? selectedName : "Jump to city / Landkreis…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-40 bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground/70 focus:outline-none lg:w-48"
        />
        {selectedName && !query && (
          <button
            type="button"
            onClick={onClear}
            title="Clear region focus"
            aria-label="Clear region focus"
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-[1200] mt-1 w-56 overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          {suggestions.map((hit, i) => (
            <li key={hit.name} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(hit)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  i === active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-gold" />
                <span className="font-medium">{hit.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
