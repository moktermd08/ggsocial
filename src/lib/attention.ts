/**
 * What a manager should look at, in the order they should look at it.
 *
 * Pure rules, no database: the server gathers the facts (`src/server/attention.ts`)
 * and these functions decide how urgent each one is and how to say it in plain
 * words. Anything that does not need a person is left out — the dashboard exists
 * to save time, not to list everything.
 */

export type Severity = "now" | "today" | "soon";
export const SEVERITY_ORDER: Record<Severity, number> = { now: 0, today: 1, soon: 2 };

export type AttentionKind = "reply" | "review" | "channel" | "post_failed" | "manual_post" | "goal" | "plan" | "agent";

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  severity: Severity;
  brandId: string;
  /** One line: what it is. */
  title: string;
  /** One line: why it is urgent, or what happens if nothing is done. */
  detail: string;
  /** When it started waiting; the oldest goes first inside a severity. */
  since: Date | null;
  href: string;
  action: string;
  /** What the person can do right on the dashboard, without opening the item. */
  inline?:
    | { type: "approve"; stepId: string; preview: string; score: number | null }
    | { type: "reply"; id: string; said: string; draft: string | null; url: string | null };
};

export function rankAttention<T extends { severity: Severity; since: Date | null }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity));
}

/* ------------------------------------------------------------------ errors */

export type Cause = "auth" | "rate_limit" | "ai_key" | "ai_budget" | "media" | "platform_down" | "unknown";

/** Turn a raw platform or API error into a cause and a sentence a person can act on. */
export function explainError(raw: string | null | undefined): { cause: Cause; text: string; fix: "reconnect" | "owner" | "post" | "wait" } {
  const e = (raw ?? "").toLowerCase();
  // Auth wins over rate-limit wording: a revoked token is never fixed by waiting.
  if (/anthropic|x-api-key|api key/.test(e) && /401|invalid|unauthor/.test(e))
    return { cause: "ai_key", text: "The AI key was rejected, so the agent could not write anything.", fix: "owner" };
  if (/budget|spend cap|quota exceeded/.test(e))
    return { cause: "ai_budget", text: "The AI budget for the day is used up, so the agents paused.", fix: "owner" };
  if (/401|403|unauthori|token|expired|revoked|reconnect|oauth|permission/.test(e))
    return { cause: "auth", text: "The sign-in to this account lapsed.", fix: "reconnect" };
  if (/429|rate.?limit|too many|throttl/.test(e))
    return { cause: "rate_limit", text: "The platform is throttling us; it retries by itself.", fix: "wait" };
  if (/media|image|video|aspect|codec|file size|too large|dimension/.test(e))
    return { cause: "media", text: "The platform refused the image or video.", fix: "post" };
  if (/5\d\d|timeout|timed out|unavailable|econn|network/.test(e))
    return { cause: "platform_down", text: "The platform did not answer. Check it before retrying; it may have posted.", fix: "post" };
  return { cause: "unknown", text: raw?.trim() ? raw.trim().slice(0, 140) : "It failed without saying why.", fix: "post" };
}

/* --------------------------------------------------------------- severities */

const HOUR = 3_600_000;

/** A comment, message or review waiting for a person. null = not worth interrupting for yet. */
export function replySeverity(i: { dueAt: Date | null; priority: string; reach: number | null; sentiment: string | null; kind?: string }, now: Date): Severity | null {
  const late = i.dueAt ? i.dueAt.getTime() <= now.getTime() : false;
  const big = (i.reach ?? 0) >= 1000;
  const negative = i.sentiment === "negative";
  if (late && (i.priority === "high" || big || negative)) return "now";
  if (late) return i.kind === "lead" ? "now" : "today";
  if (i.priority === "high" && i.dueAt && i.dueAt.getTime() - now.getTime() <= 4 * HOUR) return "today";
  return null;
}

/** Work held for a person: a safety stop or a scheduled slot about to be missed is "now". */
export function reviewSeverity(r: { safety: boolean; waitingSince: Date; slotAt: Date | null }, now: Date): Severity {
  if (r.safety) return "now";
  if (r.slotAt && r.slotAt.getTime() - now.getTime() <= 6 * HOUR) return "now";
  if (now.getTime() - r.waitingSince.getTime() >= 4 * HOUR) return "today";
  return "soon";
}

/** The "review is on for this step" reason is routine; anything else is a safety stop. */
export function isSafetyStop(reasons: string[]): boolean {
  return reasons.some((r) => !/^review is on for this step/i.test(r.trim()));
}

/* -------------------------------------------------------------- time words */

export function waited(since: Date | null, now: Date): string {
  if (!since) return "";
  const m = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function inWords(at: Date | null, now: Date): string {
  if (!at) return "";
  const m = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (m < 0) return `${waited(at, now)} ago`;
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `in ${h}h` : `in ${Math.round(h / 24)}d`;
}

/* ----------------------------------------------------------------- summary */

/** One sentence for the top of the page. `wrong` counts items that already sit inside now/today. */
export function headline(c: { now: number; today: number; wrong: number }): { text: string; tone: "bad" | "warn" | "ok" } {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const wrong = c.wrong ? ` (${c.wrong} went wrong)` : "";
  if (c.now > 0) return { text: `${plural(c.now, "thing")} need${c.now === 1 ? "s" : ""} you now${wrong}${c.today ? `, ${c.today} more today` : ""}.`, tone: "bad" };
  if (c.today > 0) return { text: `${plural(c.today, "thing")} to look at today${wrong}. Nothing is urgent.`, tone: "warn" };
  return { text: "All clear. The agents are running everything; nothing needs you.", tone: "ok" };
}

/** Days from `now` (brand-agnostic, 24h steps) with nothing booked, out of the next `days`. */
export function emptyDays(bookedAt: Date[], now: Date, days = 7): number {
  const taken = new Set(bookedAt.map((d) => Math.floor((d.getTime() - now.getTime()) / (24 * HOUR))));
  let empty = 0;
  for (let k = 0; k < days; k++) if (!taken.has(k)) empty++;
  return empty;
}
