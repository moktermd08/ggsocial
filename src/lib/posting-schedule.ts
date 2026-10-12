/**
 * When a channel may post. Client-safe: no database.
 *
 * A channel posts only at its own times. Where those come from, first found
 * wins:
 *
 *   1. the channel's own times (`postTimes` / `postDays` in its settings)
 *   2. the playbook rule for the content's format (a reel's windows, say)
 *   3. the brand's feed-post rule
 *   4. the house default, three times a day
 *
 * A window in a playbook rule ("08:00-10:00") is used by its start, so a rule
 * and a channel say the same thing in the same way.
 */
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { parseDays, parseWindows } from "@/lib/playbook/check";

export const DEFAULT_POST_TIMES = ["09:00", "13:00", "17:00"];

export type Schedule = {
  /** Wall-clock "HH:MM" in the brand's timezone, ascending. */
  times: string[];
  /** Allowed weekdays, 0 = Sunday. null = every day. */
  days: Set<number> | null;
  /** Where the times came from, for display. */
  source: "channel" | "format" | "post" | "default";
};

const DAY = 86_400_000;

export function parseTimes(text: string | undefined | null): string[] {
  if (!text?.trim()) return [];
  const out = new Set<string>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    out.add(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return [...out].sort();
}

/** Throws a readable message for the settings form when the text is not times. */
export function assertTimes(text: string) {
  const parsed = parseTimes(text);
  const asked = text.split(/[,\s]+/).filter(Boolean).length;
  if (parsed.length !== asked) throw new Error(`Posting times look like "09:00, 13:30" — could not read "${text}".`);
  return parsed;
}

type RuleLimits = { windows?: string; days?: string };

export function resolveSchedule(args: {
  channelSettings?: Record<string, unknown> | null;
  /** The playbook rule for this content's format, and the brand's feed-post rule. */
  formatRule?: RuleLimits | null;
  postRule?: RuleLimits | null;
}): Schedule {
  const s = args.channelSettings ?? {};
  const own = parseTimes(typeof s.postTimes === "string" ? s.postTimes : "");
  const ownDays = typeof s.postDays === "string" ? parseDays(s.postDays) : null;
  const fromRule = (r: RuleLimits | null | undefined) => {
    const times = parseWindows(r?.windows).map((w) => {
      const h = Math.floor(w.from / 60) % 24;
      return `${String(h).padStart(2, "0")}:${String(w.from % 60).padStart(2, "0")}`;
    });
    return { times: [...new Set(times)].sort(), days: parseDays(r?.days) };
  };
  const fmt = fromRule(args.formatRule);
  const post = fromRule(args.postRule);

  // Days and times fall back independently: a channel can set only the times.
  const days = ownDays ?? fmt.days ?? post.days ?? null;
  if (own.length) return { times: own, days, source: "channel" };
  if (fmt.times.length) return { times: fmt.times, days, source: "format" };
  if (post.times.length) return { times: post.times, days, source: "post" };
  return { times: DEFAULT_POST_TIMES, days, source: "default" };
}

function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** True when the instant lands on one of the schedule's times, on an allowed day. */
export function onSchedule(at: Date, sch: Schedule, timezone: string) {
  const local = toLocalInput(at, timezone);
  return (!sch.days || sch.days.has(weekdayOf(local.slice(0, 10)))) && sch.times.includes(local.slice(11, 16));
}

/**
 * The instant a post wanted for this channel, moved to when the channel may
 * post. A time already on the schedule is kept, even if it is a little late;
 * anything else goes to the next slot after the later of the request and now.
 */
export function snapToSchedule(requested: Date, sch: Schedule, timezone: string, now = new Date()): Date {
  if (onSchedule(requested, sch, timezone)) return requested;
  const from = requested.getTime() > now.getTime() ? requested : now;
  const startDate = toLocalInput(from, timezone).slice(0, 10);
  for (let i = 0; i < 15; i++) {
    const date = new Date(Date.parse(`${startDate}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
    if (sch.days && !sch.days.has(weekdayOf(date))) continue;
    for (const t of sch.times) {
      const at = fromLocalInput(`${date}T${t}`, timezone);
      if (at && at.getTime() >= from.getTime()) return at;
    }
  }
  // Nothing in two weeks (a schedule with no usable days): leave the request alone.
  return requested;
}

/** "Mon–Fri · 09:00, 13:00" for the channel list and calendar. */
export function describeSchedule(sch: Schedule) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = sch.days
    ? [1, 2, 3, 4, 5, 6, 0].filter((d) => sch.days!.has(d)).map((d) => names[d]).join(" ")
    : "Every day";
  return `${days} · ${sch.times.join(", ")}`;
}
