import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import {
  db, activityChecks, activityTemplates, brandActivitySettings, brands, channels, goalRevisions, goalTemplates, goals,
  interactions, linkClicks, links, metricSnapshots,
} from "@/lib/db";
import { GOAL_LIBRARY } from "@/lib/goals/library";
import {
  METRIC_META, compact, singular, type GoalDriver, type GoalGrain, type GoalMetric, type GoalPlan, type RevisionKind,
} from "@/lib/goals/meta";
import {
  DAYS_PER_MONTH, addDays, buildPlan, daysBetween, effectiveYield, levelAt, needsApproval, paceOf, pathValue,
  projectHit, requiredBetween, learnYields, type ActivityInfo, type GoalPath, type Point, type WeekObservation,
} from "@/lib/goals/engine";
import { periodFor, recentPeriods, todayIn, type Period } from "@/lib/activities/periods";
import { ensureActivityLibrary, type ActivityTemplate } from "@/server/activities";
import { platformOrNull } from "@/lib/platforms";
import { decryptJson } from "@/lib/crypto";

export type Goal = typeof goals.$inferSelect;
export type GoalTemplate = typeof goalTemplates.$inferSelect;
export type GoalRevision = typeof goalRevisions.$inferSelect;
type GoalBrand = { id: string; name: string; timezone: string };

/* ------------------------------------------------------------- the library */

let seeding: Promise<void> | null = null;

/** Inserts missing master goal templates by code; edits made in the app are never undone. */
export function ensureGoalLibrary() {
  seeding ??= db.insert(goalTemplates)
    .values(GOAL_LIBRARY.map((g, i) => ({
      code: g.code, metric: g.metric, name: g.name, description: g.description, drivers: g.drivers, sortOrder: (i + 1) * 10,
    })))
    .onConflictDoNothing({ target: goalTemplates.code })
    .then(() => undefined)
    .catch((e) => {
      seeding = null;
      throw e;
    });
  return seeding;
}

export async function getGoalTemplates(opts: { includeArchived?: boolean } = {}) {
  await ensureGoalLibrary();
  return db.select().from(goalTemplates)
    .where(opts.includeArchived ? undefined : isNull(goalTemplates.archivedAt))
    .orderBy(asc(goalTemplates.sortOrder), asc(goalTemplates.name));
}

/** The master-list activities a set of drivers points at, by code. */
export async function activitiesByCode(codes: string[]) {
  await ensureActivityLibrary();
  const wanted = [...new Set(codes)];
  const rows = wanted.length ? await db.select().from(activityTemplates).where(inArray(activityTemplates.code, wanted)) : [];
  return new Map(rows.map((r) => [r.code, r]));
}

export function activityInfo(t: ActivityTemplate): ActivityInfo {
  return { frequency: t.frequency, defaultTarget: t.target, minutesPerUnit: t.estMinutes / Math.max(1, t.target) };
}

const infoMap = (byCode: Map<string, ActivityTemplate>) =>
  Object.fromEntries([...byCode].map(([code, t]) => [code, activityInfo(t)]));

/**
 * Whether an activity can be done at all for this goal: general activities
 * always, platform-specific ones where the brand (or the goal's platform) has
 * a channel on one of their platforms.
 */
export function driverFits(t: ActivityTemplate | undefined, brandPlatforms: Set<string>, goalPlatform: string | null) {
  if (!t || t.archivedAt) return false;
  if (t.platforms.length === 0) return true;
  return goalPlatform ? t.platforms.includes(goalPlatform) && brandPlatforms.has(goalPlatform) : t.platforms.some((p) => brandPlatforms.has(p));
}

export async function brandPlatforms(brandId: string) {
  const rows = await db.select({ platform: channels.platform }).from(channels)
    .where(and(eq(channels.brandId, brandId), isNull(channels.archivedAt)));
  return new Set(rows.map((r) => r.platform));
}

/* --------------------------------------------------------------- actuals */

/** The channels a goal counts: all the brand's, or one platform's. Archived ones keep their history. */
async function scopeChannelIds(brandId: string, platform: string | null) {
  const rows = await db.select({ id: channels.id }).from(channels)
    .where(and(eq(channels.brandId, brandId), platform ? eq(channels.platform, platform) : undefined));
  return new Set(rows.map((r) => r.id));
}

export type StockSeries = {
  /** The level at the end of a day, or null before the first reading. */
  at: (date: string) => number | null;
  first: string | null;
  /** The last day every channel has a reading for — later levels are carried forward. */
  knownThrough: string | null;
  /** The newest reading on any channel. */
  latest: string | null;
};

/**
 * A stock metric's level over time from its snapshots: each channel's
 * readings joined with straight lines and summed. A channel first logged
 * later counts at its first reading from the start, so adding a channel to
 * the log does not look like a jump in followers. A whole-brand reading is
 * used only when no channel in scope has readings of its own.
 */
export async function stockSeries(brandId: string, metric: GoalMetric, platform: string | null): Promise<StockSeries> {
  const ids = await scopeChannelIds(brandId, platform);
  const rows = await db.select({ channelId: metricSnapshots.channelId, date: metricSnapshots.date, value: metricSnapshots.value })
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.brandId, brandId), eq(metricSnapshots.metric, metric)))
    .orderBy(asc(metricSnapshots.date));

  const byChannel = new Map<string, Point[]>();
  const brandLevel: Point[] = [];
  for (const r of rows) {
    if (r.channelId) {
      if (!ids.has(r.channelId)) continue;
      if (!byChannel.has(r.channelId)) byChannel.set(r.channelId, []);
      byChannel.get(r.channelId)!.push({ date: r.date, value: r.value });
    } else if (!platform) {
      brandLevel.push({ date: r.date, value: r.value });
    }
  }
  const series = byChannel.size ? [...byChannel.values()] : brandLevel.length ? [brandLevel] : [];
  if (series.length === 0) return { at: () => null, first: null, knownThrough: null, latest: null };

  const first = series.reduce((m, s) => (s[0].date < m ? s[0].date : m), series[0][0].date);
  const knownThrough = series.reduce((m, s) => (s[s.length - 1].date < m ? s[s.length - 1].date : m), series[0][series[0].length - 1].date);
  const latest = series.reduce((m, s) => (s[s.length - 1].date > m ? s[s.length - 1].date : m), series[0][series[0].length - 1].date);
  return {
    first, knownThrough, latest,
    at: (date) => (date < first ? null : series.reduce((sum, s) => sum + (date < s[0].date ? s[0].value : levelAt(s, date) ?? 0), 0)),
  };
}

const dayOf = (column: unknown, tz: string) => sql<string>`to_char((${column} at time zone ${tz})::date, 'YYYY-MM-DD')`;
const between = (column: unknown, tz: string, from: string, to: string) =>
  sql`(${column} at time zone ${tz})::date between ${from}::date and ${to}::date`;

const INTERACTION_KINDS: Partial<Record<GoalMetric, string[]>> = {
  comments: ["comment", "reply"],
  messages: ["message"],
  leads: ["lead"],
};

/**
 * A flow metric's count per day over [from, to] in the brand's timezone:
 * what the app counts for itself, plus any snapshots logged by hand for what
 * it cannot see.
 */
export async function flowDaily(brand: GoalBrand, metric: GoalMetric, platform: string | null, from: string, to: string) {
  const tz = brand.timezone || "UTC";
  const out = new Map<string, number>();
  const add = (d: string, n: number) => out.set(d, (out.get(d) ?? 0) + Number(n));
  const source = METRIC_META[metric].source;

  if (source === "comments" || source === "messages" || source === "leads") {
    const rows = await db.select({ d: dayOf(interactions.receivedAt, tz), n: sql<number>`count(*)::int` })
      .from(interactions)
      .leftJoin(channels, eq(channels.id, interactions.channelId))
      .where(and(
        eq(interactions.brandId, brand.id),
        inArray(interactions.kind, INTERACTION_KINDS[metric] as never[]),
        eq(interactions.direction, "inbound"),
        between(interactions.receivedAt, tz, from, to),
        platform ? eq(channels.platform, platform) : undefined,
      ))
      .groupBy(sql`1`);
    for (const r of rows) add(r.d, r.n);
  } else if (source === "clicks") {
    const rows = await db.select({
      d: dayOf(linkClicks.clickedAt, tz),
      n: sql<number>`count(distinct coalesce(${linkClicks.visitorHash}, ${linkClicks.id}))::int`,
    })
      .from(linkClicks)
      .innerJoin(links, eq(links.id, linkClicks.linkId))
      .leftJoin(channels, eq(channels.id, links.channelId))
      .where(and(
        eq(links.brandId, brand.id),
        eq(linkClicks.isBot, false),
        between(linkClicks.clickedAt, tz, from, to),
        platform ? eq(channels.platform, platform) : undefined,
      ))
      .groupBy(sql`1`);
    for (const r of rows) add(r.d, r.n);
  } else if (source === "post_engagement" || source === "post_reach") {
    const value = source === "post_engagement"
      ? sql.raw("m.likes + m.comment_count + m.shares + m.saves")
      : sql.raw("case when m.reach > 0 then m.reach else m.impressions end");
    const rows = await db.execute<{ d: string; n: number }>(sql`
      select to_char((pt.published_at at time zone ${tz})::date, 'YYYY-MM-DD') as d, sum(${value})::float8 as n
      from post_targets pt
      join posts p on p.id = pt.post_id
      join channels c on c.id = pt.channel_id
      join lateral (select * from metrics m where m.target_id = pt.id order by m.fetched_at desc limit 1) m on true
      where p.brand_id = ${brand.id} and pt.status = 'published' and pt.published_at is not null
        and (pt.published_at at time zone ${tz})::date between ${from}::date and ${to}::date
        ${platform ? sql`and c.platform = ${platform}` : sql``}
      group by 1`);
    for (const r of rows) add(r.d, r.n);
  }

  // Readings logged by hand: added on top, for what the app cannot see.
  const ids = platform ? await scopeChannelIds(brand.id, platform) : null;
  const manual = await db.select({ channelId: metricSnapshots.channelId, date: metricSnapshots.date, value: metricSnapshots.value })
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.brandId, brand.id), eq(metricSnapshots.metric, metric), gte(metricSnapshots.date, from), lte(metricSnapshots.date, to)));
  for (const r of manual) {
    if (ids && (!r.channelId || !ids.has(r.channelId))) continue;
    add(r.date, r.value);
  }
  return out;
}

const sumDays = (daily: Map<string, number>, from: string, to: string) => {
  let s = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) s += daily.get(d) ?? 0;
  return s;
};

/** A flow's monthly rate over the 28 complete days before `date`. */
const rate28 = (daily: Map<string, number>, date: string) => (sumDays(daily, addDays(date, -28), addDays(date, -1)) * DAYS_PER_MONTH) / 28;

/**
 * Everything the goal maths needs to read the metric: the stock series, or
 * the flow's daily counts from `from` to today.
 */
async function actuals(goal: Goal, brand: GoalBrand, from: string, today: string) {
  const kind = METRIC_META[goal.metric].kind;
  if (kind === "stock") {
    const series = await stockSeries(brand.id, goal.metric, goal.platform);
    return { kind, series, daily: null as Map<string, number> | null, now: series.at(today) };
  }
  const daily = await flowDaily(brand, goal.metric, goal.platform, addDays(from, -28), today);
  return { kind, series: null, daily, now: rate28(daily, today) };
}
type Actuals = Awaited<ReturnType<typeof actuals>>;

/**
 * Where a stock goal really started. A channel logged for the first time
 * after the start was there all along, so the series counts it from the
 * beginning — and so must the start, or its whole audience would read as
 * gained today. Falls back to the value typed at creation.
 */
function startLevel(goal: Goal, a: Actuals) {
  if (!a.series?.first || a.series.first > goal.startDate) return goal.startValue;
  return a.series.at(goal.startDate) ?? goal.startValue;
}

/** The audience that audience-scaled yields are worked at: the goal's own level, or the brand's followers. */
async function audienceFor(goal: Goal, a: Actuals, brandId: string, date: string) {
  if (a.series) return a.series.at(date) ?? goal.startValue;
  const followers = await stockSeries(brandId, "followers", null);
  return followers.at(date) ?? 1000;
}

/* ------------------------------------------------------- activity volume */

/**
 * Units of each driver's activity done over any window, from the checklist
 * ticks. A tick with a count uses it; "done" without one counts as the target
 * that applied, "partly" as half. A monthly tick is spread over its month.
 */
async function volumeReader(brandId: string, byCode: Map<string, ActivityTemplate>, from: string, to: string) {
  const templates = [...byCode.values()];
  if (templates.length === 0) return () => ({} as Record<string, number>);
  const ids = templates.map((t) => t.id);
  const [checks, settings] = await Promise.all([
    db.select().from(activityChecks).where(and(
      eq(activityChecks.brandId, brandId), inArray(activityChecks.templateId, ids),
      lte(activityChecks.periodStart, to), gte(activityChecks.periodEnd, from),
    )),
    db.select().from(brandActivitySettings).where(and(eq(brandActivitySettings.brandId, brandId), inArray(brandActivitySettings.templateId, ids))),
  ]);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const targetOf = new Map(templates.map((t) => [t.id, settings.find((s) => s.templateId === t.id)?.target ?? t.target]));
  const done = checks.map((c) => ({
    code: byId.get(c.templateId)!.code,
    start: c.periodStart, end: c.periodEnd,
    units: c.count ?? (c.status === "done" ? targetOf.get(c.templateId)! : c.status === "partial" ? targetOf.get(c.templateId)! / 2 : 0),
  }));
  return (start: string, end: string) => {
    const out: Record<string, number> = {};
    for (const c of done) {
      const lo = c.start > start ? c.start : start;
      const hi = c.end < end ? c.end : end;
      if (lo > hi) continue;
      const share = (daysBetween(lo, hi) + 1) / (daysBetween(c.start, c.end) + 1);
      out[c.code] = (out[c.code] ?? 0) + c.units * share;
    }
    return out;
  };
}

/* ------------------------------------------------------------ learning */

/**
 * The last twelve complete weeks the goal can learn from: weeks with a known
 * gain (a stock needs readings on both sides) and what was done in each.
 */
async function observeWeeks(goal: Goal, brand: GoalBrand, a: Actuals, today: string, byCode: Map<string, ActivityTemplate>) {
  const earliest = addDays(goal.startDate, -28);
  const weeks = recentPeriods("weekly", addDays(today, -7), 12).filter((w) => w.start >= earliest);
  if (weeks.length === 0) return [] as (WeekObservation & { week: Period })[];
  const volume = await volumeReader(brand.id, byCode, weeks[0].start, weeks[weeks.length - 1].end);
  const followers = a.series ? null : await stockSeries(brand.id, "followers", null);

  const out: (WeekObservation & { week: Period })[] = [];
  for (const week of weeks) {
    const before = addDays(week.start, -1);
    let gain: number;
    let audience: number;
    if (a.series) {
      if (!a.series.first || !a.series.knownThrough || before < a.series.first || week.end > a.series.knownThrough) continue;
      gain = a.series.at(week.end)! - a.series.at(before)!;
      audience = a.series.at(before)!;
    } else {
      gain = sumDays(a.daily!, week.start, week.end);
      audience = followers?.at(before) ?? 1000;
    }
    out.push({ week, gain, audience, units: volume(week.start, week.end) });
  }
  return out;
}

/* ---------------------------------------------------------- recalibrate */

const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

function yieldPhrase(d: GoalDriver, y: number, audience: number, noun: string) {
  const ey = effectiveYield({ ...d, yield: y }, audience);
  const v = ey >= 10 ? n0(ey) : ey >= 1 ? ey.toFixed(1) : ey.toFixed(2);
  return `${v} ${noun} per ${singular(d.unitLabel)}`;
}

/**
 * Learns from the weeks so far, re-anchors the path on today's actual and
 * works out a new plan. Small changes apply at once; a change bigger than the
 * goal's threshold waits for a person. Returns the revision it wrote.
 */
export async function recalibrateGoal(goalId: string, opts: { userId: string | null; kind?: RevisionKind; forceApply?: boolean }) {
  const goal = await db.query.goals.findFirst({ where: eq(goals.id, goalId) });
  if (!goal) throw new Error("Goal not found.");
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, goal.brandId), columns: { id: true, name: true, timezone: true } });
  if (!brand) throw new Error("Brand not found.");
  const kind = opts.kind ?? "recalibration";
  const meta = METRIC_META[goal.metric];
  const today = todayIn(brand.timezone);
  const byCode = await activitiesByCode(goal.drivers.map((d) => d.activityCode));

  const a = await actuals(goal, brand, addDays(today, -7 * 13), today);
  const observed = kind === "initial" ? [] : await observeWeeks(goal, brand, a, today, byCode);
  const learned = learnYields({ weeks: observed, drivers: goal.drivers, baselinePrior: 0 });
  const learning = learned.weeksUsed >= 2;
  const drivers: GoalDriver[] = goal.drivers.map((d) => ({ ...d, yield: learning ? learned.yields[d.activityCode] ?? d.yield : d.yield }));
  const baseline = learning ? learned.baseline : goal.baseline;

  const anchor = kind === "initial" || a.now === null
    ? { date: goal.plan?.anchorDate ?? goal.startDate, value: goal.plan?.anchorValue ?? goal.startValue }
    : { date: today, value: a.now };
  if (kind === "initial") { anchor.date = goal.startDate; anchor.value = startLevel(goal, a); }
  const audience = await audienceFor(goal, a, brand.id, anchor.date);

  const plan = buildPlan({
    kind: meta.kind, curve: goal.curve, anchorDate: anchor.date, anchorValue: anchor.value,
    targetValue: goal.targetValue, deadline: goal.deadline, drivers, baseline, audience, activities: infoMap(byCode),
  });

  /* Why, in words. */
  const start = startLevel(goal, a);
  const original: GoalPath = { kind: meta.kind, curve: goal.curve, anchorDate: goal.startDate, anchorValue: start, targetValue: goal.targetValue, deadline: goal.deadline };
  const planned = pathValue(original, today);
  const reasons: string[] = [];
  let headline = "";
  if (kind === "initial") {
    headline = `First plan: ${n0(plan.required)} ${meta.noun} in the next 7 days, about ${plan.hoursPerWeek} h of work a week.`;
  } else if (a.now === null) {
    headline = "No numbers yet, so the plan stays on its benchmarks.";
    reasons.push(meta.kind === "stock" ? "Log follower counts (or connect a live channel) so the plan can measure progress." : "Nothing counted yet for this metric.");
  } else {
    const { pace, ratio } = paceOf(a.now, planned, start, meta.kind);
    const diff = a.now - planned;
    headline = pace === "ahead" || pace === "on_track"
      ? `${pace === "ahead" ? "Ahead of" : "On"} plan — ${meta.kind === "stock" ? `${n0(a.now)} ${meta.noun}` : `${n0(a.now)} ${meta.noun} a month`} against ${n0(planned)} planned.`
      : `Behind plan by ${n0(Math.abs(diff))} ${meta.noun}${meta.kind === "flow" ? " a month" : ""}${ratio !== null ? ` (${Math.round(ratio * 100)}% of the planned progress)` : ""}. The remaining gap is spread over the time left.`;
  }
  if (learning) {
    reasons.push(`Learned from ${learned.weeksUsed} week${learned.weeksUsed === 1 ? "" : "s"} of results.`);
    for (const d of goal.drivers) {
      const now = learned.yields[d.activityCode];
      if (now === undefined || d.yield <= 0) continue;
      const change = now / d.yield - 1;
      if (Math.abs(change) >= 0.1) {
        reasons.push(`${d.label}: now about ${yieldPhrase(d, now, audience, meta.noun)} (${pct(change)} vs last plan).`);
      }
    }
    if (Math.abs(baseline - goal.baseline) >= Math.max(1, Math.abs(goal.baseline) * 0.2)) {
      reasons.push(`Organic change without any work: about ${baseline >= 0 ? "+" : ""}${n0(baseline)} ${meta.noun} a week.`);
    }
  } else if (kind === "recalibration") {
    reasons.push("Not enough weeks of results to learn from yet — benchmarks still in use.");
  }
  const before = goal.plan?.units ?? {};
  for (const d of drivers) {
    const was = before[d.activityCode] ?? 0;
    const now = plan.units[d.activityCode] ?? 0;
    if (was !== now && kind !== "initial") reasons.push(`${d.label}: ${was} → ${now} a week.`);
  }
  if (!plan.feasible) {
    reasons.push(plan.reachDate
      ? `Even at full capacity the target lands around ${plan.reachDate}, after the deadline. Consider moving the deadline, raising capacity or adding paid promotion.`
      : `At full capacity the plan gets to about ${compact(plan.atDeadline)} by the deadline. The target needs more capacity, more drivers or paid promotion.`);
  }

  const bigChange = Boolean(goal.plan) && needsApproval(before, plan.units, goal.approvalThreshold);
  const status = kind === "recalibration" && !opts.forceApply && bigChange ? "proposed" : "applied";
  const yields = Object.fromEntries(drivers.map((d) => [d.activityCode, d.yield]));

  const revision = await db.transaction(async (tx) => {
    await tx.update(goalRevisions).set({ status: "superseded" })
      .where(and(eq(goalRevisions.goalId, goal.id), eq(goalRevisions.status, "proposed")));
    const [row] = await tx.insert(goalRevisions).values({
      goalId: goal.id, kind, status,
      summary: status === "proposed" ? `${headline} Big change — waiting for approval.` : headline,
      reasons,
      before: goal.plan ? { plan: goal.plan, yields: Object.fromEntries(goal.drivers.map((d) => [d.activityCode, d.yield])), baseline: goal.baseline } : null,
      after: { plan, yields, baseline },
      actualValue: a.now, plannedValue: planned,
      createdBy: opts.userId,
      decidedBy: status === "applied" ? opts.userId : null,
      decidedAt: status === "applied" ? new Date() : null,
    }).returning();
    if (status === "applied") {
      await tx.update(goals).set({ drivers, baseline, plan, lastRecalibratedAt: new Date(), updatedAt: new Date() }).where(eq(goals.id, goal.id));
    } else {
      await tx.update(goals).set({ lastRecalibratedAt: new Date() }).where(eq(goals.id, goal.id));
    }
    return row;
  });
  if (status === "applied") await applyActivityTargets(goal.brandId);
  return revision;
}

/** Puts a proposed plan into force, or turns it down. */
export async function decideRevision(revisionId: string, approve: boolean, userId: string) {
  const rev = await db.query.goalRevisions.findFirst({ where: eq(goalRevisions.id, revisionId) });
  if (!rev || rev.status !== "proposed") throw new Error("That plan is no longer waiting for a decision.");
  const goal = await db.query.goals.findFirst({ where: eq(goals.id, rev.goalId) });
  if (!goal) throw new Error("Goal not found.");
  await db.update(goalRevisions).set({
    status: approve ? "applied" : "rejected",
    summary: rev.summary.replace(" Big change — waiting for approval.", approve ? " Approved." : " Turned down; the plan stayed as it was."),
    decidedBy: userId, decidedAt: new Date(),
  }).where(eq(goalRevisions.id, rev.id));
  if (approve) {
    const drivers = goal.drivers.map((d) => ({ ...d, yield: rev.after.yields[d.activityCode] ?? d.yield }));
    await db.update(goals).set({ drivers, baseline: rev.after.baseline, plan: rev.after.plan, updatedAt: new Date() }).where(eq(goals.id, goal.id));
    await applyActivityTargets(goal.brandId);
  }
  return goal;
}

/* -------------------------------------------------- activity checklists */

/**
 * Writes every active goal's weekly volumes into the brand's activity plan.
 * Where two goals want the same activity, the higher target wins: one video
 * serves both followers and engagement. Rows a person set by hand are left
 * alone; rows no goal needs any more go back to the master.
 */
export async function applyActivityTargets(brandId: string) {
  const active = await db.select({ id: goals.id, plan: goals.plan, drivers: goals.drivers, platform: goals.platform }).from(goals)
    .where(and(eq(goals.brandId, brandId), eq(goals.status, "active"), isNotNull(goals.plan)));
  const want = new Map<string, { target: number; goalId: string }>();
  for (const g of active) {
    for (const [code, target] of Object.entries(g.plan?.targets ?? {})) {
      if (!g.drivers.find((d) => d.activityCode === code)?.enabled) continue;
      const cur = want.get(code);
      if (!cur || target > cur.target) want.set(code, { target, goalId: g.id });
    }
  }
  const [byCode, platforms, settings] = await Promise.all([
    activitiesByCode([...want.keys()]),
    brandPlatforms(brandId),
    db.select().from(brandActivitySettings).where(eq(brandActivitySettings.brandId, brandId)),
  ]);

  const kept: string[] = [];
  for (const [code, { target, goalId }] of want) {
    const t = byCode.get(code);
    if (!t || !driverFits(t, platforms, null)) continue;
    const row = settings.find((s) => s.templateId === t.id);
    // Set by hand: a person's decision outranks the plan.
    if (row && !row.goalId && (row.target !== null || row.enabled !== null)) continue;
    kept.push(t.id);
    await db.insert(brandActivitySettings).values({ brandId, templateId: t.id, enabled: true, target, goalId })
      .onConflictDoUpdate({
        target: [brandActivitySettings.brandId, brandActivitySettings.templateId],
        set: { enabled: true, target, goalId, updatedAt: new Date() },
      });
  }
  await db.delete(brandActivitySettings).where(and(
    eq(brandActivitySettings.brandId, brandId), isNotNull(brandActivitySettings.goalId),
    kept.length ? notInArray(brandActivitySettings.templateId, kept) : undefined,
  ));
}

/* ------------------------------------------------------------ snapshots */

export type SnapshotInput = { brandId: string; channelId: string | null; metric: GoalMetric; date: string; value: number };

export async function saveSnapshots(entries: SnapshotInput[], source: "manual" | "api", userId: string | null) {
  if (entries.length === 0) return 0;
  const byKey = new Map(entries.map((e) => [`${e.brandId}:${e.metric}:${e.channelId ?? "brand"}:${e.date}`, e]));
  await db.insert(metricSnapshots).values([...byKey.values()].map((e) => ({
    brandId: e.brandId, channelId: e.channelId, scopeKey: e.channelId ?? "brand", metric: e.metric,
    date: e.date, value: e.value, source, createdBy: userId,
  }))).onConflictDoUpdate({
    target: [metricSnapshots.brandId, metricSnapshots.metric, metricSnapshots.scopeKey, metricSnapshots.date],
    set: { value: sql.raw("excluded.value"), source: sql.raw("excluded.source"), createdBy: sql.raw("excluded.created_by"), updatedAt: new Date() },
  });
  return byKey.size;
}

export async function deleteSnapshot(brandId: string, channelId: string | null, metric: GoalMetric, date: string) {
  await db.delete(metricSnapshots).where(and(
    eq(metricSnapshots.brandId, brandId), eq(metricSnapshots.metric, metric),
    eq(metricSnapshots.scopeKey, channelId ?? "brand"), eq(metricSnapshots.date, date),
  ));
}

/**
 * Pulls today's follower count from every live channel whose platform can
 * report it. With `onlyMissing`, channels already read today are skipped, so
 * the hourly job costs one API call per channel per day.
 */
export async function pullAccountStats(opts: { brandIds?: string[]; onlyMissing?: boolean } = {}) {
  const rows = await db.select({ channel: channels, timezone: brands.timezone }).from(channels)
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(and(
      eq(channels.mode, "live"), isNull(channels.archivedAt), isNull(brands.archivedAt),
      opts.brandIds ? inArray(channels.brandId, opts.brandIds) : undefined,
    ));
  const results: { channelId: string; handle: string; platform: string; followers?: number; error?: string; skipped?: boolean }[] = [];
  for (const { channel, timezone } of rows) {
    const platform = platformOrNull(channel.platform);
    if (!platform?.fetchAccountStats) continue;
    const today = todayIn(timezone);
    if (opts.onlyMissing) {
      const have = await db.query.metricSnapshots.findFirst({
        where: and(eq(metricSnapshots.scopeKey, channel.id), eq(metricSnapshots.metric, "followers"), eq(metricSnapshots.date, today)),
        columns: { id: true },
      });
      if (have) {
        results.push({ channelId: channel.id, handle: channel.handle, platform: channel.platform, skipped: true });
        continue;
      }
    }
    try {
      const stats = await platform.fetchAccountStats({ channel, credentials: decryptJson<Record<string, string>>(channel.credentials) });
      if (typeof stats.followers === "number" && Number.isFinite(stats.followers)) {
        await saveSnapshots([{ brandId: channel.brandId, channelId: channel.id, metric: "followers", date: today, value: stats.followers }], "api", null);
      }
      results.push({ channelId: channel.id, handle: channel.handle, platform: channel.platform, followers: stats.followers });
    } catch (err) {
      results.push({ channelId: channel.id, handle: channel.handle, platform: channel.platform, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/* ------------------------------------------------------------- cron */

/**
 * The hourly job: read follower counts once a day, recalibrate every active
 * goal once a week (the first tick of each Monday in the brand's timezone),
 * and close goals that have landed.
 */
export async function runGoalJobs() {
  const stats = await pullAccountStats({ onlyMissing: true });
  const active = await db.select({ goal: goals, timezone: brands.timezone, name: brands.name }).from(goals)
    .innerJoin(brands, eq(brands.id, goals.brandId))
    .where(and(eq(goals.status, "active"), isNull(brands.archivedAt)));

  const recalibrated: string[] = [];
  const achieved: string[] = [];
  const failed: { goalId: string; error: string }[] = [];
  for (const { goal, timezone, name } of active) {
    const today = todayIn(timezone);
    try {
      const a = await actuals(goal, { id: goal.brandId, name, timezone }, addDays(today, -35), today);
      if (a.now !== null && a.now >= goal.targetValue) {
        await db.update(goals).set({ status: "achieved", updatedAt: new Date() }).where(eq(goals.id, goal.id));
        await applyActivityTargets(goal.brandId);
        achieved.push(goal.id);
        continue;
      }
      const weekStart = periodFor("weekly", today).start;
      const last = goal.lastRecalibratedAt ? todayIn(timezone, goal.lastRecalibratedAt) : null;
      if (last && last >= weekStart) continue;
      await recalibrateGoal(goal.id, { userId: null });
      recalibrated.push(goal.id);
    } catch (err) {
      failed.push({ goalId: goal.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    followersPulled: stats.filter((s) => s.followers !== undefined).length,
    statErrors: stats.filter((s) => s.error).length,
    recalibrated, achieved, failed,
  };
}

/* ------------------------------------------------------------- reading */

export async function getGoalsForBrands(brandIds: string[], opts: { includeArchived?: boolean } = {}) {
  if (brandIds.length === 0) return [];
  return db.select().from(goals)
    .where(and(inArray(goals.brandId, brandIds), opts.includeArchived ? undefined : sql`${goals.status} <> 'archived'`))
    .orderBy(asc(goals.deadline));
}

export async function getGoal(goalId: string) {
  return db.query.goals.findFirst({ where: eq(goals.id, goalId) });
}

export async function getRevisions(goalId: string, limit = 30) {
  return db.select().from(goalRevisions).where(eq(goalRevisions.goalId, goalId)).orderBy(desc(goalRevisions.createdAt)).limit(limit);
}

/** Goal paths: the original from the start, and the one in force since the last recalibration. */
export function goalPaths(goal: Goal, start = goal.startValue) {
  const kind = METRIC_META[goal.metric].kind;
  const original: GoalPath = { kind, curve: goal.curve, anchorDate: goal.startDate, anchorValue: start, targetValue: goal.targetValue, deadline: goal.deadline };
  // A plan still anchored on the start day follows the start, however it was corrected.
  const current: GoalPath = goal.plan && goal.plan.anchorDate !== goal.startDate
    ? { ...original, anchorDate: goal.plan.anchorDate, anchorValue: goal.plan.anchorValue }
    : original;
  /** Planned over [from, to]: the original path up to the anchor, the current one after it. */
  const plannedBetween = (from: string, to: string) => {
    if (from > to) return 0;
    const split = current.anchorDate;
    if (to <= split) return requiredBetween(original, from, to);
    if (from > split) return requiredBetween(current, from, to);
    return requiredBetween(original, from, split) + requiredBetween(current, addDays(split, 1), to);
  };
  return { kind, original, current, plannedBetween };
}

export type Insight = { tone: "good" | "warn" | "bad" | "info"; text: string };

export type DriverRow = {
  code: string;
  label: string;
  unitLabel: string;
  enabled: boolean;
  scale: GoalDriver["scale"];
  activityTitle: string | null;
  frequency: ActivityTemplate["frequency"] | null;
  /** Metric per unit at today's audience. */
  perUnit: number;
  perUnitPrior: number;
  yieldChange: number;
  weeklyPlanned: number;
  periodTarget: number | null;
  doneThisWeek: number;
  plannedThisWeekSoFar: number;
  done4w: number;
  planned4w: number;
  /** Metric the plan expected but did not get because units were not done, last four weeks. */
  lost4w: number;
  share: number;
  capped: boolean;
  maxPerWeek: number;
  /** Set by hand on the activity list, so the goal cannot move it. */
  manualTarget: number | null;
};

export type GrainRow = {
  grain: GoalGrain;
  period: Period;
  planned: number;
  expectedSoFar: number;
  actual: number | null;
  elapsed: number;
};

export type GoalState = Awaited<ReturnType<typeof getGoalState>>;

const GRAIN_FREQ: Record<GoalGrain, "daily" | "weekly" | "monthly" | "quarterly" | "yearly"> = {
  daily: "daily", weekly: "weekly", monthly: "monthly", quarterly: "quarterly", yearly: "yearly",
};
const HISTORY_LENGTH: Record<GoalGrain, number> = { daily: 14, weekly: 10, monthly: 8, quarterly: 6, yearly: 3 };

/**
 * Everything the progress view shows for one goal: where it is, against
 * which plan, per day / week / month / quarter / year, what each activity is
 * delivering, and what to fix first.
 */
export async function getGoalState(goal: Goal, brand: GoalBrand, opts: { grain?: GoalGrain; history?: boolean } = {}) {
  const meta = METRIC_META[goal.metric];
  const today = todayIn(brand.timezone);
  const kind = meta.kind;
  const grain = opts.grain ?? "weekly";

  const historyPeriods = opts.history === false ? [] : recentPeriods(GRAIN_FREQ[grain], today, HISTORY_LENGTH[grain]);
  const grainPeriods = (["daily", "weekly", "monthly", "quarterly", "yearly"] as GoalGrain[]).map((g) => ({ grain: g, period: periodFor(GRAIN_FREQ[g], today) }));
  const earliest = [addDays(goal.startDate, -56), addDays(today, -7 * 13), ...historyPeriods.map((p) => p.start), ...grainPeriods.map((g) => g.period.start)]
    .reduce((m, d) => (d < m ? d : m));
  const a = await actuals(goal, brand, earliest, today);
  const start = startLevel(goal, a);
  const { original, current, plannedBetween } = goalPaths(goal, start);

  const gainBetween = (from: string, to: string): number | null => {
    const end = to < today ? to : today;
    if (end < from) return 0;
    if (a.series) {
      const hi = a.series.at(end);
      const lo = a.series.at(addDays(from, -1));
      return hi === null || lo === null ? null : hi - lo;
    }
    return sumDays(a.daily!, from, end);
  };

  /* Where things stand. */
  const plannedNow = pathValue(original, today);
  const { pace, ratio } = paceOf(a.now, plannedNow, start, kind);
  const totalGap = goal.targetValue - start;
  const progress = a.now === null ? 0 : totalGap !== 0 ? Math.max(0, Math.min(1, (a.now - start) / totalGap)) : 1;
  const daysLeft = Math.max(0, daysBetween(today, goal.deadline));
  const elapsedShare = Math.max(0, Math.min(1, daysBetween(goal.startDate, today) / Math.max(1, daysBetween(goal.startDate, goal.deadline))));

  let then: number | null = null;
  let span = 28;
  if (a.series && a.now !== null && a.series.first) {
    const from = addDays(today, -28) < a.series.first ? a.series.first : addDays(today, -28);
    span = daysBetween(from, today);
    then = a.series.at(from);
  } else if (a.daily) {
    then = rate28(a.daily, addDays(today, -28));
  }
  const projection = a.now === null ? { rate: null, date: null } : projectHit({ kind, today, now: a.now, then, spanDays: span, target: goal.targetValue });

  /* The chart: original plan, current plan, actual — with up to eight weeks before the start for context. */
  const context = addDays(goal.startDate, -56);
  const chartStart = a.series
    ? (a.series.first && a.series.first < goal.startDate ? (a.series.first > context ? a.series.first : context) : goal.startDate)
    : addDays(goal.startDate, -28);
  const total = Math.max(1, daysBetween(chartStart, goal.deadline));
  const step = Math.max(1, Math.ceil(total / 90));
  const point = (date: string) => ({
    date,
    original: date >= goal.startDate ? pathValue(original, date) : null,
    current: date >= current.anchorDate ? pathValue(current, date) : null,
    actual: date > today ? null : a.series ? a.series.at(date) : rate28(a.daily!, addDays(date, 1)),
  });
  const chart: { date: string; original: number | null; current: number | null; actual: number | null }[] = [];
  for (let d = chartStart; ; d = addDays(d, step)) {
    const date = d > goal.deadline ? goal.deadline : d;
    chart.push(point(date));
    if (date >= goal.deadline) break;
  }
  // Today and the start day always sit on the chart, even between steps.
  for (const date of [goal.startDate, today]) {
    if (date > chartStart && date < goal.deadline && !chart.some((p) => p.date === date)) chart.push(point(date));
  }
  chart.sort((x, y) => (x.date < y.date ? -1 : 1));

  /* Day / week / month / quarter / year right now. Only the part since the goal started counts. */
  const fromStart = (d: string) => (d < goal.startDate ? goal.startDate : d);
  const grains: GrainRow[] = grainPeriods.map(({ grain: g, period }) => {
    const soFarEnd = today < period.end ? today : period.end;
    const from = fromStart(period.start);
    return {
      grain: g, period,
      planned: plannedBetween(from, period.end),
      expectedSoFar: plannedBetween(from, soFarEnd),
      actual: gainBetween(from, soFarEnd),
      elapsed: period.end >= today ? (daysBetween(period.start, today) + 0.5) / (daysBetween(period.start, period.end) + 1) : 1,
    };
  });
  // Periods before the goal started show what happened, with nothing planned.
  const history = historyPeriods.map((period) => {
    const before = period.end < goal.startDate;
    const from = before ? period.start : fromStart(period.start);
    return {
      period,
      planned: before ? 0 : plannedBetween(from, period.end),
      actual: period.start > today ? null : gainBetween(from, period.end),
      current: period.end >= today,
      beforeStart: before,
    };
  });

  /* Drivers: plan against what was done. */
  const byCode = await activitiesByCode(goal.drivers.map((d) => d.activityCode));
  const week = periodFor("weekly", today);
  const past4 = recentPeriods("weekly", addDays(week.start, -1), 4);
  const volume = await volumeReader(brand.id, byCode, past4[0].start, week.end);
  const revisions = await db.select({ createdAt: goalRevisions.createdAt, after: goalRevisions.after }).from(goalRevisions)
    .where(and(eq(goalRevisions.goalId, goal.id), eq(goalRevisions.status, "applied"))).orderBy(asc(goalRevisions.createdAt));
  const unitsInForce = (date: string) => {
    let units: Record<string, number> | null = null;
    for (const r of revisions) if (todayIn(brand.timezone, r.createdAt) <= date) units = r.after.plan.units;
    return units;
  };
  const settings = await db.select().from(brandActivitySettings).where(and(
    eq(brandActivitySettings.brandId, brand.id),
    byCode.size ? inArray(brandActivitySettings.templateId, [...byCode.values()].map((t) => t.id)) : undefined,
  ));
  const audience = await audienceFor(goal, a, brand.id, today);
  const doneWeek = volume(week.start, week.end);
  const weekElapsed = (daysBetween(week.start, today) + 1) / 7;
  const pastDone = past4.map((w) => ({ w, done: volume(w.start, w.end), planned: unitsInForce(w.start) }));
  const plannedGains = goal.plan?.gains ?? {};
  const plannedTotal = Object.values(plannedGains).reduce((s, g) => s + g, 0);

  const driverRows: DriverRow[] = goal.drivers.map((d) => {
    const t = byCode.get(d.activityCode);
    const weekly = goal.plan?.units[d.activityCode] ?? 0;
    const perUnit = effectiveYield(d, audience);
    const perUnitPrior = effectiveYield({ ...d, yield: d.priorYield }, audience);
    let done4w = 0, planned4w = 0, lost4w = 0;
    for (const p of pastDone) {
      const planned = p.planned?.[d.activityCode] ?? 0;
      const done = p.done[d.activityCode] ?? 0;
      done4w += done;
      planned4w += planned;
      lost4w += Math.max(0, planned - done) * perUnit;
    }
    const setting = t ? settings.find((s) => s.templateId === t.id) : undefined;
    return {
      code: d.activityCode, label: d.label, unitLabel: d.unitLabel, enabled: d.enabled, scale: d.scale,
      activityTitle: t?.title ?? null, frequency: t?.frequency ?? null,
      perUnit, perUnitPrior, yieldChange: d.priorYield > 0 ? d.yield / d.priorYield - 1 : 0,
      weeklyPlanned: weekly,
      periodTarget: goal.plan?.targets[d.activityCode] ?? null,
      doneThisWeek: doneWeek[d.activityCode] ?? 0,
      plannedThisWeekSoFar: weekly * weekElapsed,
      done4w, planned4w, lost4w,
      share: plannedTotal > 0 ? (plannedGains[d.activityCode] ?? 0) / plannedTotal : 0,
      capped: weekly >= d.maxPerWeek && d.maxPerWeek > 0,
      maxPerWeek: d.maxPerWeek,
      manualTarget: setting && !setting.goalId && setting.target !== null ? setting.target : null,
    };
  });

  /* What to do about it, in words. */
  const insights: Insight[] = [];
  const noun = meta.noun;
  if (a.now === null) {
    insights.push({ tone: "warn", text: kind === "stock" ? "No follower counts yet. Log today's numbers (or connect a live channel) so progress can be measured." : `Nothing counted yet for ${meta.label.toLowerCase()}. ${meta.how}` });
  } else if (a.series?.latest && daysBetween(a.series.latest, today) >= 7) {
    insights.push({ tone: "warn", text: `The last count was logged ${daysBetween(a.series.latest, today)} days ago. Log fresh numbers so the plan is steering on facts.` });
  }
  const worst = [...driverRows].filter((r) => r.enabled && r.lost4w > 0).sort((x, y) => y.lost4w - x.lost4w);
  if (worst[0] && worst[0].lost4w >= Math.max(1, Math.abs(goal.plan?.required ?? 0) * 0.05)) {
    const w = worst[0];
    insights.push({
      tone: pace === "behind" || pace === "at_risk" ? "bad" : "warn",
      text: `${w.label}: ${n0(w.done4w)} of ${n0(w.planned4w)} planned in the last 4 weeks. At about ${fmtPer(w.perUnit)} ${noun} each, that is roughly ${compact(w.lost4w)} ${noun} not gained${pace === "behind" || pace === "at_risk" ? " — the biggest reason for the gap" : ""}.`,
    });
  }
  for (const r of worst.slice(1, 3)) {
    if (r.lost4w < worst[0].lost4w * 0.35) break;
    insights.push({ tone: "warn", text: `${r.label} also fell short: ${n0(r.done4w)} of ${n0(r.planned4w)} done (≈ ${compact(r.lost4w)} ${noun} missed).` });
  }
  const best = [...driverRows].filter((r) => r.enabled && r.yieldChange >= 0.3).sort((x, y) => y.yieldChange - x.yieldChange)[0];
  if (best) insights.push({ tone: "good", text: `${best.label} are working ${Math.round((best.yieldChange + 1) * 10) / 10}× better than the benchmark, so the plan leans on them more.` });
  const weak = [...driverRows].filter((r) => r.enabled && r.yieldChange <= -0.35 && r.done4w > 0).sort((x, y) => x.yieldChange - y.yieldChange)[0];
  if (weak) insights.push({ tone: "warn", text: `${weak.label} bring only ${Math.round((weak.yieldChange + 1) * 100)}% of the benchmark. Improve them (hooks, targeting, timing) or switch the driver off so the plan stops relying on them.` });
  const thisWeek = grains.find((g) => g.grain === "weekly")!;
  if (thisWeek.actual !== null && thisWeek.planned > 0) {
    const left = Math.max(0, thisWeek.planned - thisWeek.actual);
    const days = daysBetween(today, thisWeek.period.end);
    insights.push({
      tone: thisWeek.actual >= thisWeek.expectedSoFar ? "good" : "info",
      text: left <= 0
        ? `This week's ${n0(thisWeek.planned)} ${noun} are already in. Keep the routine going.`
        : `This week needs ${n0(thisWeek.planned)} ${noun}; ${n0(thisWeek.actual)} so far, ${n0(left)} to go with ${days === 0 ? "today left" : `${days + 1} days left`}.`,
    });
  }
  if (goal.plan && !goal.plan.feasible) {
    insights.push({
      tone: "bad",
      text: goal.plan.reachDate
        ? `Even with every activity at its weekly cap, the target lands around ${goal.plan.reachDate}, after the ${goal.deadline} deadline. Move the deadline, raise the caps, add drivers or budget for paid promotion.`
        : `At full capacity this plan reaches about ${compact(goal.plan.atDeadline)} by the deadline. Raise the caps, add drivers or budget for paid promotion.`,
    });
  }
  const manual = driverRows.filter((r) => r.enabled && r.manualTarget !== null && r.periodTarget !== null && r.manualTarget < r.periodTarget);
  if (manual.length) {
    insights.push({ tone: "warn", text: `${manual.map((r) => r.label).join(", ")} ${manual.length === 1 ? "has" : "have"} a target set by hand below what the goal needs. Hand ${manual.length === 1 ? "it" : "them"} back to the goal below.` });
  }

  return {
    goal, meta, today, kind, pace, ratio, progress, elapsedShare, daysLeft, start,
    now: a.now, plannedNow, projection, audience,
    latestReading: a.series?.latest ?? null,
    chart, grains, history, drivers: driverRows, insights,
    original, current,
  };
}

function fmtPer(n: number) {
  return n >= 10 ? n0(n) : n >= 1 ? n.toFixed(1) : n.toFixed(2);
}

/** A light read for the goal cards: where it stands and the next week's top activities. */
export async function getGoalSummary(goal: Goal, brand: GoalBrand) {
  const s = await getGoalState(goal, brand, { history: false });
  const weeks = s.chart.filter((p) => p.actual !== null).slice(-12).map((p) => p.actual as number);
  const top = s.drivers.filter((d) => d.enabled && d.weeklyPlanned > 0).sort((a, b) => b.share - a.share).slice(0, 4);
  return {
    goal, meta: s.meta, today: s.today, pace: s.pace, progress: s.progress, elapsedShare: s.elapsedShare, daysLeft: s.daysLeft, start: s.start,
    now: s.now, plannedNow: s.plannedNow, projection: s.projection, trend: weeks,
    week: s.grains.find((g) => g.grain === "weekly")!,
    top, feasible: goal.plan?.feasible ?? true, hoursPerWeek: goal.plan?.hoursPerWeek ?? 0,
    headline: s.insights.find((i) => i.tone === "bad") ?? s.insights[0] ?? null,
  };
}
export type GoalSummary = Awaited<ReturnType<typeof getGoalSummary>>;

/** Pending approvals per goal, for badges. */
export async function proposedCounts(goalIds: string[]) {
  if (goalIds.length === 0) return new Map<string, number>();
  const rows = await db.select({ goalId: goalRevisions.goalId, n: sql<number>`count(*)::int` }).from(goalRevisions)
    .where(and(inArray(goalRevisions.goalId, goalIds), eq(goalRevisions.status, "proposed")))
    .groupBy(goalRevisions.goalId);
  return new Map(rows.map((r) => [r.goalId, r.n]));
}

export { type GoalPlan };
