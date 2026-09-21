import type { PostStatus, TargetStatus } from "@/lib/db";

export const STATUS_META: Record<PostStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#8b8b96" },
  in_review: { label: "Needs approval", color: "#b45309" },
  changes_requested: { label: "Changes requested", color: "#b91c1c" },
  approved: { label: "Approved", color: "#0f766e" },
  scheduled: { label: "Scheduled", color: "#4f46e5" },
  publishing: { label: "Publishing…", color: "#4f46e5" },
  published: { label: "Published", color: "#15803d" },
  partially_published: { label: "Partly published", color: "#b45309" },
  failed: { label: "Failed", color: "#b91c1c" },
};

export const TARGET_STATUS_META: Record<TargetStatus, { label: string; color: string }> = {
  pending: { label: "Not scheduled", color: "#8b8b96" },
  scheduled: { label: "Scheduled", color: "#4f46e5" },
  publishing: { label: "Publishing", color: "#4f46e5" },
  awaiting_manual: { label: "Ready to post", color: "#b45309" },
  published: { label: "Published", color: "#15803d" },
  failed: { label: "Failed", color: "#b91c1c" },
  skipped: { label: "Skipped", color: "#8b8b96" },
};

/** Renders an instant in a specific IANA timezone — brands travel. */
export function inZone(date: Date | string | null | undefined, timezone: string, opts: Intl.DateTimeFormatOptions = {}) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...opts,
  }).format(d);
}

/**
 * `now` is a parameter so a server render and its hydration can be handed the
 * same instant — otherwise a row that crosses a minute boundary between the two
 * renders different text on each side and React tears the tree down.
 */
export function relativeTime(date: Date | string | null | undefined, now = Date.now()) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60_000], ["hour", 3_600_000], ["day", 86_400_000], ["week", 604_800_000], ["month", 2_592_000_000],
  ];
  if (abs < 60_000) return "just now";
  let last: [Intl.RelativeTimeFormatUnit, number] = units[0];
  for (const u of units) if (abs >= u[1]) last = u;
  return rtf.format(Math.round(diff / last[1]), last[0]);
}

export function truncate(text: string, n = 120) {
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the *displayed* timezone. */
export function toLocalInput(date: Date | string | null | undefined, timezone: string) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Inverse of toLocalInput: reads wall-clock time in a zone back to an instant. */
export function fromLocalInput(value: string, timezone: string): Date | null {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  // Start from the UTC interpretation, then correct by that zone's offset.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = zoneOffset(new Date(guess), timezone);
  return new Date(guess - offset);
}

function zoneOffset(date: Date, timezone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUTC - date.getTime();
}

export const COMMON_TIMEZONES = [
  "UTC", "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Lisbon",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo",
  "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo",
  "Australia/Sydney",
];

/**
 * Consecutive UTC days from `startOffset` to `endOffset` days relative to
 * `now`, for charts that need a column even on days nothing happened.
 */
export function utcDays(startOffset: number, endOffset: number, now = Date.now()) {
  const out: { key: string; label: string; tip: string; offset: number }[] = [];
  for (let i = startOffset; i <= endOffset; i++) {
    const d = new Date(now + i * 86400_000);
    out.push({
      key: d.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d),
      tip: i === 0 ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d),
      offset: i,
    });
  }
  return out;
}
