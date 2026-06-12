/**
 * Safely parse a date ISO string, especially in Safari which fails to parse
 * ISO strings with more than 3 fractional second digits (e.g. 2026-06-11T20:33:01.840000Z).
 */
export function safeNewDate(dateInput: string | number | Date): Date {
  if (typeof dateInput === "string") {
    const cleaned = dateInput.replace(/\.(\d{1,3})\d*([Z]|[+-]\d{2}:?\d{2})?$/, ".$1$2");
    return new Date(cleaned);
  }
  return new Date(dateInput);
}

export function timeAgo(iso: string): string {
  const deltaMs = Date.now() - safeNewDate(iso).getTime();
  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

export function confidencePercent(score: number): string {
  return `${Math.round(score * 100)} %`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatUtcTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}
