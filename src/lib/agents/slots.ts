import { fromLocalInput, toLocalInput } from "@/lib/format";
import { periodFor, todayIn } from "@/lib/activities/periods";
import { parseDays, parseWindows } from "@/lib/playbook/check";

/** Where the content writer books posts. Pure, so it can be checked without a database. */

const DEFAULT_TIMES = [9 * 60, 13 * 60, 17 * 60];
const DAY = 86_400_000;

function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * The open posting slots in the next `daysAhead` days, soonest first: on the
 * playbook's posting days, inside its windows, up to the posts-per-week target.
 */
export function openSlots(opts: {
  timezone: string;
  now: Date;
  daysAhead: number;
  perWeek: number;
  /** The feed-post rule's timing limits, when the brand has one. */
  days?: string;
  windows?: string;
  /** Instants already taken by the brand's posts. */
  taken: Date[];
}): Date[] {
  const today = todayIn(opts.timezone, opts.now);
  const allowed = parseDays(opts.days) ?? (opts.perWeek <= 5 ? new Set([1, 2, 3, 4, 5]) : null);
  const times = parseWindows(opts.windows).map((w) => w.from);
  const slotTimes = times.length ? times : DEFAULT_TIMES;
  // Never two posts at the same time: a day holds at most one post per slot time.
  const perDay = Math.min(slotTimes.length, Math.max(1, Math.ceil(opts.perWeek / (allowed?.size ?? 7))));

  const perDate = new Map<string, number[]>();
  const perWeekKey = new Map<string, number>();
  for (const t of opts.taken) {
    const local = toLocalInput(t, opts.timezone);
    const date = local.slice(0, 10);
    const [h, m] = local.slice(11).split(":").map(Number);
    perDate.set(date, [...(perDate.get(date) ?? []), h * 60 + m]);
    const wk = periodFor("weekly", date).key;
    perWeekKey.set(wk, (perWeekKey.get(wk) ?? 0) + 1);
  }

  const out: Date[] = [];
  // Tomorrow onwards: a slot today leaves no time for review.
  for (let i = 1; i <= opts.daysAhead; i++) {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (allowed && !allowed.has(weekday)) continue;
    const wk = periodFor("weekly", date).key;
    const busy = perDate.get(date) ?? [];
    let onDay = busy.length;
    // Slot times not within an hour of a post already on that day.
    const free = slotTimes.filter((t) => !busy.some((b) => Math.abs(b - t) < 60));
    while (onDay < perDay && free.length && (perWeekKey.get(wk) ?? 0) < opts.perWeek) {
      const at = fromLocalInput(`${date}T${hhmm(free.shift()!)}`, opts.timezone);
      if (!at) break;
      out.push(at);
      onDay++;
      perWeekKey.set(wk, (perWeekKey.get(wk) ?? 0) + 1);
    }
  }
  return out;
}

