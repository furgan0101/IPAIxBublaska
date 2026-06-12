/** Small display helpers shared across the dashboard. */

export function timeAgo(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
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
