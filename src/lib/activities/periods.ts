import type { Frequency } from "./meta";

/**
 * Calendar windows for each frequency, worked on plain "YYYY-MM-DD" strings in
 * UTC so the server, the browser and an agent calling the API all land on the
 * same period for the same date.
 */
export type Period = {
  frequency: Frequency;
  /** Stable id stored against every check, e.g. "2026-09-22", "2026-W39", "2026-Q3". */
  key: string;
  /** First and last day, inclusive. */
  start: string;
  end: string;
  label: string;
  /** Compact label for chart axes and table headers: "22 Sep", "W39", "Q3". */
  short: string;
  /** Any date inside the previous / next period. */
  prev: string;
  next: string;
};

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const isDateKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const toDate = (key: string) => new Date(`${key}T00:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (key: string, n: number) => toKey(new Date(toDate(key).getTime() + n * DAY));
const utc = (y: number, m: number, d: number) => toKey(new Date(Date.UTC(y, m, d)));

function short(key: string, withYear = false) {
  const d = toDate(key);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

/** ISO-8601 week number and its year (which can differ from the calendar year at the edges). */
function isoWeek(key: string) {
  const d = toDate(key);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return { year: thursday.getUTCFullYear(), week: 1 + Math.floor((thursday.getTime() - yearStart) / DAY / 7) };
}

/** Today's date in a timezone, as "YYYY-MM-DD". */
export function todayIn(timezone = "UTC", now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return toKey(now);
  }
}

export function periodFor(frequency: Frequency, date: string): Period {
  const d = toDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  let start: string, end: string, key: string, label: string, compact: string;

  switch (frequency) {
    case "daily":
      start = end = key = date;
      label = `${WEEKDAYS[d.getUTCDay()]} ${short(date, true)}`;
      compact = short(date);
      break;
    case "every_2_days": {
      // Anchored to the Unix epoch, so every brand and every agent shares the same pairs of days.
      const epochDay = Math.floor(d.getTime() / DAY);
      start = toKey(new Date((epochDay - (epochDay % 2)) * DAY));
      end = addDays(start, 1);
      key = `2d-${start}`;
      label = `${short(start)} – ${short(end, true)}`;
      compact = short(start);
      break;
    }
    case "weekly": {
      start = addDays(date, -((d.getUTCDay() + 6) % 7));
      end = addDays(start, 6);
      const w = isoWeek(start);
      key = `${w.year}-W${String(w.week).padStart(2, "0")}`;
      label = `Week ${w.week} · ${short(start)} – ${short(end, true)}`;
      compact = `W${w.week}`;
      break;
    }
    case "monthly":
      start = utc(y, m, 1);
      end = utc(y, m + 1, 0);
      key = start.slice(0, 7);
      label = `${MONTHS[m]} ${y}`;
      compact = MONTHS[m];
      break;
    case "quarterly": {
      const q = Math.floor(m / 3);
      start = utc(y, q * 3, 1);
      end = utc(y, q * 3 + 3, 0);
      key = `${y}-Q${q + 1}`;
      label = `Q${q + 1} ${y} · ${MONTHS[q * 3]} – ${MONTHS[q * 3 + 2]}`;
      compact = `Q${q + 1}`;
      break;
    }
    case "half_yearly": {
      const h = m < 6 ? 0 : 1;
      start = utc(y, h * 6, 1);
      end = utc(y, h * 6 + 6, 0);
      key = `${y}-H${h + 1}`;
      label = `H${h + 1} ${y} · ${h ? "Jul – Dec" : "Jan – Jun"}`;
      compact = `H${h + 1}`;
      break;
    }
    case "yearly":
      start = utc(y, 0, 1);
      end = utc(y, 11, 31);
      key = String(y);
      label = String(y);
      compact = String(y);
      break;
  }

  return { frequency, key, start, end, label, short: compact, prev: addDays(start, -1), next: addDays(end, 1) };
}

/** Where `today` sits relative to a period. */
export function periodPhase(period: Period, today: string): "past" | "current" | "future" {
  if (today > period.end) return "past";
  if (today < period.start) return "future";
  return "current";
}

/** The last `n` periods ending with the one containing `date`, oldest first. */
export function recentPeriods(frequency: Frequency, date: string, n: number): Period[] {
  const out: Period[] = [];
  let p = periodFor(frequency, date);
  for (let i = 0; i < n; i++) {
    out.unshift(p);
    p = periodFor(frequency, p.prev);
  }
  return out;
}
