import { FORMAT_META, isFormat } from "@/lib/formats";

/**
 * Reading a brand's numbers fairly. Client-safe: no database.
 *
 * Three rules keep the lessons honest:
 *  - A post is judged on a reading at least two days old. A post a few hours
 *    in has not finished; comparing it with ones that have says nothing.
 *  - Each post is scored against a typical post on its own platform, so a
 *    strong platform does not make everything on it look good.
 *  - A group of posts has to be big enough, and different enough from usual,
 *    before it becomes a lesson.
 */

export type Reading = {
  impressions: number; reach: number; likes: number; commentCount: number; shares: number; saves: number; clicks: number;
};

export const MATURE_HOURS = 48;
const HOUR = 3_600_000;

/** Likes, comments, shares and saves. Clicks are counted separately. */
export const engagementOf = (m: Reading) => m.likes + m.commentCount + m.shares + m.saves;

/** Engagement over the people it could have reached. null when too few saw it to say anything. */
export function engagementRate(m: Reading, minSeen = 30): number | null {
  const seen = m.reach || m.impressions;
  return seen >= minSeen ? engagementOf(m) / seen : null;
}

/**
 * The reading to judge a post by: the latest one taken once the post was
 * mature. A post old enough to be mature but only ever read early (the numbers
 * were not collected for a while) falls back on its latest reading after a
 * week. null while the post is still too young.
 */
export function matureReading<R extends Reading & { fetchedAt: Date }>(readings: R[], publishedAt: Date, now: Date): R | null {
  const ready = readings.filter((r) => r.fetchedAt.getTime() >= publishedAt.getTime() + MATURE_HOURS * HOUR);
  const latest = (rs: R[]) => rs.reduce<R | null>((best, r) => (!best || r.fetchedAt > best.fetchedAt ? r : best), null);
  if (ready.length) return latest(ready);
  return now.getTime() - publishedAt.getTime() >= 7 * 24 * HOUR ? latest(readings) : null;
}

export function median(xs: number[]) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function daypart(hour: number) {
  return hour >= 5 && hour < 11 ? "morning" : hour < 15 && hour >= 11 ? "midday" : hour >= 15 && hour < 19 ? "afternoon" : hour >= 19 && hour < 24 ? "evening" : "night";
}
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export type Observation = {
  platform: string;
  /** The format it went out as: post, carousel, thread, reel… */
  format: string;
  pillar: string | null;
  /** 0 = Sunday, in the brand's own time zone. */
  weekday: number;
  hour: number;
  rate: number;
};

export type Dimension = "format" | "platform_format" | "pillar" | "weekday" | "daypart";
export type Learning = { dimension: Dimension; key: string; n: number; lift: number; direction: "more" | "less"; statement: string };

const platformLabel = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
const formatLabel = (f: string) => (isFormat(f) ? FORMAT_META[f].label.toLowerCase() : f);
const times = (lift: number) => `${lift.toFixed(1)}×`;

/** The format a post went out as, from the choice the system made for the channel. */
export function formatOf(opts: { versionFormat?: string | null; useVersion: boolean; options?: Record<string, unknown> | null }) {
  if (opts.useVersion && opts.versionFormat) return opts.versionFormat;
  const o = opts.options ?? {};
  if (o.thread) return "thread";
  if (o.format === "reel" || o.format === "story") return String(o.format);
  return "post";
}

/**
 * What the numbers say, as short statements ranked by how much they should
 * count. Returns nothing until there are enough posts to say anything.
 */
export function deriveLearnings(
  obs: Observation[], opts: { minTotal?: number; minGroup?: number; minLift?: number; max?: number } = {},
): Learning[] {
  const { minTotal = 8, minGroup = 3, minLift = 0.25, max = 10 } = opts;
  const usable = obs.filter((o) => Number.isFinite(o.rate) && o.rate >= 0);
  if (usable.length < minTotal) return [];

  // Score each post against a typical post on its own platform.
  const overall = median(usable.map((o) => o.rate));
  const perPlatform = new Map<string, number>();
  for (const p of new Set(usable.map((o) => o.platform))) {
    const rs = usable.filter((o) => o.platform === p).map((o) => o.rate);
    perPlatform.set(p, rs.length >= minGroup ? median(rs) : overall);
  }
  const scored = usable
    .map((o) => ({ ...o, norm: (perPlatform.get(o.platform) ?? 0) > 0 ? o.rate / perPlatform.get(o.platform)! : null }))
    .filter((o): o is typeof o & { norm: number } => o.norm !== null);
  if (scored.length < minTotal) return [];

  const dims: { dimension: Dimension; keyOf: (o: (typeof scored)[number]) => string | null; say: (key: string, lift: number, n: number) => string }[] = [
    { dimension: "format", keyOf: (o) => o.format, say: (k, l, n) => `Posts that go out as a ${formatLabel(k)} earn ${times(l)} the usual engagement (${n} posts).` },
    { dimension: "platform_format", keyOf: (o) => `${o.platform}:${o.format}`, say: (k, l, n) => { const [p, f] = k.split(":"); return `On ${platformLabel(p)}, a ${formatLabel(f)} earns ${times(l)} the usual engagement (${n} posts).`; } },
    { dimension: "pillar", keyOf: (o) => o.pillar, say: (k, l, n) => `Posts under "${k}" earn ${times(l)} the usual engagement (${n} posts).` },
    { dimension: "weekday", keyOf: (o) => WEEKDAYS[o.weekday], say: (k, l, n) => `Posts on ${k} earn ${times(l)} the usual engagement (${n} posts).` },
    { dimension: "daypart", keyOf: (o) => daypart(o.hour), say: (k, l, n) => `Posts in the ${k} earn ${times(l)} the usual engagement (${n} posts).` },
  ];

  const found: (Learning & { weight: number })[] = [];
  for (const d of dims) {
    const groups = new Map<string, number[]>();
    for (const o of scored) {
      const key = d.keyOf(o);
      if (key) (groups.get(key) ?? groups.set(key, []).get(key)!).push(o.norm);
    }
    // One group on its own is not a comparison: a lesson needs something to be better or worse than.
    if (groups.size < 2) continue;
    for (const [key, norms] of groups) {
      if (norms.length < minGroup) continue;
      const lift = median(norms);
      if (Math.abs(lift - 1) < minLift) continue;
      found.push({
        dimension: d.dimension, key, n: norms.length, lift: Number(lift.toFixed(2)),
        direction: lift > 1 ? "more" : "less", statement: d.say(key, lift, norms.length),
        weight: Math.abs(Math.log(lift)) * Math.sqrt(norms.length),
      });
    }
  }
  return found.sort((a, b) => b.weight - a.weight).slice(0, max).map((l) => ({ dimension: l.dimension, key: l.key, n: l.n, lift: l.lift, direction: l.direction, statement: l.statement }));
}
