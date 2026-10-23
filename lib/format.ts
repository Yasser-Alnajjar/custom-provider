import { RESOLVED_STATUSES, type Person, type Ticket } from "./types";

export function initials(name = ""): string {
  return (
    String(name)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function humanize(value: unknown): string {
  const text = String(value ?? "").replace(/_/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const time = (value: string | null | undefined) => toDate(value)?.getTime() ?? 0;

export function absoluteDate(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return "—";

  const seconds = Math.round((now - d.getTime()) / 1000);

  // A timestamp well ahead of this device's clock is clock skew; show it as-is.
  if (seconds < -300) {
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return relativeFormat.format(-minutes, "minute");

  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeFormat.format(-hours, "hour");

  const days = Math.round(hours / 24);
  if (days < 7) return relativeFormat.format(-days, "day");

  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "under a minute";

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Only trust resolved_at when the ticket is actually resolved and the dates make sense. */
export function resolutionMs(t: Pick<Ticket, "status" | "created_at" | "resolved_at">): number | null {
  if (!RESOLVED_STATUSES.includes(t.status)) return null;

  const created = toDate(t.created_at);
  const resolved = toDate(t.resolved_at);

  if (!created || !resolved || resolved < created) return null;
  return resolved.getTime() - created.getTime();
}

export const displayName = (person: Person | null | undefined) => person?.name || person?.email || "";

export const href = (...parts: string[]) => "/" + parts.map((p) => encodeURIComponent(p)).join("/");

export function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Decodes a route param, tolerating values that were already decoded. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
