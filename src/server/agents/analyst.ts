import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, activity, activityChecks, activityTemplates, channels, goals, metrics, posts, postTargets } from "@/lib/db";
import { platformOrNull } from "@/lib/platforms";
import { localClock } from "@/lib/playbook/check";
import { toLocalInput } from "@/lib/format";
import { periodFor, todayIn } from "@/lib/activities/periods";
import type { Frequency } from "@/lib/activities/meta";
import { agentActorName } from "@/lib/agents/meta";
import { METRIC_META } from "@/lib/goals/meta";
import { ensureActivityLibrary, recordCheck } from "@/server/activities";
import { refreshMetrics } from "@/server/publish";
import { askClaude, addUsage } from "@/server/agents/claude";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The performance analyst. From 07:00 brand time it reads the brand's numbers
 * and ticks the checks that ask for a read of them, each with its note, for a
 * person to review like any other check:
 *
 *   D-16  every day   yesterday's posts against the 30-day usual
 *   W-15  each week   the week against the week before, with W-16: the top
 *                     and bottom posts and what they teach
 *   M-14  each month  the month against the month before
 *
 * Each read is one low-effort call; a report with nothing published is
 * written without one. Lessons go onto the posts, where the strategist
 * builds the next ideas from them.
 */

const DAY = 86_400_000;
const START_MINUTE = 7 * 60;
const actor = { kind: "ai" as const, name: agentActorName("analyst"), userId: null };

const SYSTEM = `You are the analyst on a brand's social media team. You read the brand's numbers against its own recent past and tell the team, in plain words, what stood out and what to do about it.

What good looks like:
- Compare with the brand's usual, not with the wider internet.
- Engagement rate (likes, comments, shares and saves over reach or impressions) and clicks matter more than raw reach. Saves and shares signal content worth repeating.
- Say what probably caused a result only when the posts give you a reason to think so; otherwise say it is too early to tell.
- Concrete next steps, tied to what you saw — never generic advice.
- Where a platform shares no numbers, say so once rather than guessing.
- Short enough to read in a minute.`;

const ReportSchema = z.object({
  note: z.string().describe("The read for the team: what stood out against the usual, and what to try next. Three to eight sentences."),
  standouts: z.array(z.object({
    postId: z.string(),
    learning: z.string().describe("One sentence: what this post teaches, to keep on the post."),
  })).describe("Only posts clearly above or below the usual. Often empty."),
});

type Numbers = { impressions: number; reach: number; engagements: number; clicks: number; n: number };
const engagementsOf = (m: typeof metrics.$inferSelect) => m.likes + m.commentCount + m.shares + m.saves;

type Row = { postId: string; title: string; postType: string | null; platform: string; day: string; m: typeof metrics.$inferSelect | null };

/** Every published channel copy in the window, with its latest reading. */
async function published(brand: AgentJob["brand"], sinceDays: number, now: Date): Promise<Row[]> {
  const rows = await db.select({ target: postTargets, post: posts, platform: channels.platform })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(eq(posts.brandId, brand.id), eq(postTargets.status, "published"), gte(postTargets.publishedAt, new Date(now.getTime() - sinceDays * DAY))));
  const latest = new Map<string, typeof metrics.$inferSelect>();
  if (rows.length) {
    const ms = await db.select().from(metrics).where(inArray(metrics.targetId, rows.map((r) => r.target.id))).orderBy(desc(metrics.fetchedAt));
    for (const m of ms) if (!latest.has(m.targetId)) latest.set(m.targetId, m);
  }
  return rows.map((r) => ({
    postId: r.post.id, title: r.post.title || r.post.body.slice(0, 60), postType: r.post.postType, platform: r.platform,
    day: r.target.publishedAt ? toLocalInput(r.target.publishedAt, brand.timezone).slice(0, 10) : "",
    m: latest.get(r.target.id) ?? null,
  }));
}

function totals(rows: Row[]) {
  const by = new Map<string, Numbers>();
  for (const r of rows) {
    if (!r.m) continue;
    const t = by.get(r.platform) ?? { impressions: 0, reach: 0, engagements: 0, clicks: 0, n: 0 };
    t.impressions += r.m.impressions; t.reach += r.m.reach; t.engagements += engagementsOf(r.m); t.clicks += r.m.clicks; t.n++;
    by.set(r.platform, t);
  }
  return by;
}

const name = (p: string) => platformOrNull(p)?.name ?? p;
const got = (m: Row["m"]) => m
  ? `${m.impressions} impressions, ${m.reach} reach, ${m.likes} likes, ${m.commentCount} comments, ${m.shares} shares, ${m.saves} saves, ${m.clicks} clicks`
  : "no numbers from this platform";
const rate = (m: Row["m"]) => (m ? engagementsOf(m) / Math.max(1, m.reach || m.impressions) : -1);

/** Has this check been done for the period that `date` falls in? */
async function checkDone(brandId: string, code: string, frequency: Frequency, date: string) {
  const template = await db.query.activityTemplates.findFirst({ where: eq(activityTemplates.code, code) });
  if (!template) return true;
  const period = periodFor(frequency, date);
  const had = await db.query.activityChecks.findFirst({
    where: and(eq(activityChecks.brandId, brandId), eq(activityChecks.templateId, template.id), eq(activityChecks.periodKey, period.key)),
    columns: { id: true },
  });
  return Boolean(had);
}

/** Which reads are due now: from 07:00 brand time, those not yet done this day, week or month. */
async function dueReads(brandId: string, timezone: string, now: Date) {
  if (localClock(now.toISOString(), timezone).minute < START_MINUTE) return [];
  await ensureActivityLibrary();
  const today = todayIn(timezone, now);
  const due: ("daily" | "weekly" | "monthly")[] = [];
  if (!(await checkDone(brandId, "D-16", "daily", today))) due.push("daily");
  if (!(await checkDone(brandId, "W-15", "weekly", today))) due.push("weekly");
  if (!(await checkDone(brandId, "M-14", "monthly", today))) due.push("monthly");
  return due;
}

export async function analystDue(brandId: string, timezone: string, now: Date) {
  return (await dueReads(brandId, timezone, now)).length > 0;
}

/** Keeps each standout's lesson on its post, where the strategist reads it. Returns how many were new. */
async function keepLessons(standouts: { postId: string; learning: string }[], allowed: Set<string>, out: AgentOutcome) {
  let learned = 0;
  for (const s of standouts) {
    if (!allowed.has(s.postId) || !s.learning.trim()) continue;
    const post = await db.query.posts.findFirst({ where: eq(posts.id, s.postId), columns: { title: true, keyLearning: true } });
    if (!post || post.keyLearning?.trim()) continue;
    await db.update(posts).set({ keyLearning: s.learning.trim(), updatedAt: new Date() }).where(eq(posts.id, s.postId));
    out.items.push({ kind: "post", id: s.postId, label: `Lesson noted on "${post.title || "a post"}"`, href: `/posts/${s.postId}` });
    learned++;
  }
  return learned;
}

async function daily(job: AgentJob, out: AgentOutcome) {
  const { brand, config, now } = job;
  const today = todayIn(brand.timezone, now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const rows = await published(brand, 31, now);
  const fromYesterday = rows.filter((r) => r.day === yesterday);

  if (fromYesterday.length === 0) {
    const notes = "Nothing was published yesterday, so there is nothing new to read.";
    await recordCheck({ brandId: brand.id, code: "D-16", date: today, status: "done", notes }, actor, "auto");
    out.items.push({ kind: "check", id: null, label: `D-16: ${notes}`, href: "/activities" });
    return "Nothing published yesterday.";
  }
  const typical = totals(rows.filter((r) => r.day < yesterday));
  const lines = fromYesterday.map((r) => {
    const t = typical.get(r.platform);
    const avg = t && t.n ? `typical here: ${Math.round(t.impressions / t.n)} impressions, ${Math.round(t.reach / t.n)} reach, ${Math.round(t.engagements / t.n)} engagements, ${Math.round(t.clicks / t.n)} clicks over ${t.n} posts` : "no earlier numbers on this platform";
    return `- postId: ${r.postId} | ${name(r.platform)} | "${r.title}"${r.postType ? ` (${r.postType})` : ""}\n  got: ${got(r.m)}\n  ${avg}`;
  });
  const task = [
    config.guidelines?.trim() ? `Standing guidelines from the brand's team (follow these):\n${config.guidelines.trim()}\n` : "",
    `A daily read, in three to five sentences with one thing to try. Yesterday (${yesterday}) the brand published:`,
    ...lines,
  ].filter(Boolean).join("\n");
  const { output, usage } = await askClaude({ schema: ReportSchema, system: SYSTEM, brand, task, effort: "low", job: "analysis", source: "agent:analyst" });
  out.usage = addUsage(out.usage, usage);
  const learned = await keepLessons(output.standouts, new Set(fromYesterday.map((r) => r.postId)), out);
  await recordCheck({ brandId: brand.id, code: "D-16", date: today, status: "done", count: new Set(fromYesterday.map((r) => r.postId)).size, notes: output.note }, actor, "auto");
  out.items.unshift({ kind: "note", id: null, label: output.note, href: "/activities" });
  return `Read ${fromYesterday.length} post${fromYesterday.length === 1 ? "" : "s"} from yesterday.${learned ? ` Noted ${learned} lesson${learned === 1 ? "" : "s"}.` : ""}`;
}

/** The week or month against the one before: the same read, over a longer window. */
async function period(job: AgentJob, out: AgentOutcome, span: "weekly" | "monthly") {
  const { brand, config, now } = job;
  const days = span === "weekly" ? 7 : 30;
  const today = todayIn(brand.timezone, now);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
  const before = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * days * DAY).toISOString().slice(0, 10);
  const rows = await published(brand, 2 * days + 1, now);
  const current = rows.filter((r) => r.day >= since && r.day < today);
  const earlier = rows.filter((r) => r.day >= before && r.day < since);
  const code = span === "weekly" ? "W-15" : "M-14";
  const label = span === "weekly" ? "week" : "month";

  if (current.length === 0) {
    const notes = `Nothing was published in the last ${label}, so there is nothing to compare.`;
    await recordCheck({ brandId: brand.id, code, date: today, status: "done", count: 0, notes }, actor, "auto");
    if (span === "weekly") await recordCheck({ brandId: brand.id, code: "W-16", date: today, status: "done", count: 0, notes }, actor, "auto");
    return notes;
  }

  const thisSpan = totals(current), then = totals(earlier);
  const platforms = [...new Set([...thisSpan.keys(), ...then.keys()])];
  const byRate = current.filter((r) => r.m).sort((a, b) => rate(b.m) - rate(a.m));
  const top = byRate.slice(0, 3), bottom = byRate.slice(-3).reverse().filter((r) => !top.includes(r));
  const active = await db.select({ name: goals.name, metric: goals.metric, targetValue: goals.targetValue, deadline: goals.deadline })
    .from(goals).where(and(eq(goals.brandId, brand.id), eq(goals.status, "active")));
  const posted = new Set(current.map((r) => r.postId)).size;

  const task = [
    config.guidelines?.trim() ? `Standing guidelines from the brand's team (follow these):\n${config.guidelines.trim()}\n` : "",
    `A ${span} report: the last ${label} (${since} to ${today}) against the ${label} before. End with up to three concrete things to do next ${label}.`,
    `Posts published: ${posted} (the ${label} before: ${new Set(earlier.map((r) => r.postId)).size}).`,
    "By platform, this " + label + " vs the one before:",
    ...platforms.map((p) => {
      const a = thisSpan.get(p), b = then.get(p);
      const fmt = (t?: Numbers) => (t ? `${t.n} posts, ${t.impressions} impressions, ${t.reach} reach, ${t.engagements} engagements, ${t.clicks} clicks` : "nothing");
      return `- ${name(p)}: ${fmt(a)} | before: ${fmt(b)}`;
    }),
    top.length ? `\nBest posts by engagement rate:\n${top.map((r) => `- postId: ${r.postId} | ${name(r.platform)} | "${r.title}" — ${got(r.m)}`).join("\n")}` : "",
    bottom.length ? `\nWeakest posts:\n${bottom.map((r) => `- postId: ${r.postId} | ${name(r.platform)} | "${r.title}" — ${got(r.m)}`).join("\n")}` : "",
    active.length ? `\nThe brand's goals:\n${active.map((g) => `- ${g.name}: ${METRIC_META[g.metric]?.label ?? g.metric} to ${g.targetValue} by ${g.deadline}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const { output, usage } = await askClaude({ schema: ReportSchema, system: SYSTEM, brand, task, effort: "low", job: "analysis", source: "agent:analyst" });
  out.usage = addUsage(out.usage, usage);
  const learned = await keepLessons(output.standouts, new Set([...top, ...bottom].map((r) => r.postId)), out);
  await recordCheck({ brandId: brand.id, code, date: today, status: "done", count: posted, notes: output.note }, actor, "auto");
  if (span === "weekly") {
    const tb = [
      top.length ? `Top: ${top.map((r) => `"${r.title}" (${name(r.platform)})`).join(", ")}.` : "",
      bottom.length ? `Bottom: ${bottom.map((r) => `"${r.title}" (${name(r.platform)})`).join(", ")}.` : "",
      learned ? `${learned} lesson${learned === 1 ? "" : "s"} noted on the posts.` : "",
    ].filter(Boolean).join(" ");
    await recordCheck({ brandId: brand.id, code: "W-16", date: today, status: "done", count: top.length + bottom.length, notes: tb || "Too few numbers to rank." }, actor, "auto");
  }
  await db.insert(activity).values({
    brandId: brand.id, actorId: null, action: `agent.${span}_report`, entity: "brand", entityId: brand.id,
    meta: { agent: "analyst", posts: posted, learned, ...usage },
  });
  out.items.push({ kind: "note", id: null, label: `${span === "weekly" ? "Weekly" : "Monthly"} report: ${output.note}`, href: "/activities" });
  return `${span === "weekly" ? "Weekly" : "Monthly"} report written (${posted} post${posted === 1 ? "" : "s"}).`;
}

export async function runAnalyst(job: AgentJob): Promise<AgentOutcome> {
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };
  const due = await dueReads(job.brand.id, job.brand.timezone, job.now);
  if (due.length === 0) {
    out.summary = "Every read is done for today, this week and this month.";
    return out;
  }
  const refreshed = await refreshMetrics(job.brand.id, 62);
  const done: string[] = [];
  if (due.includes("daily")) done.push(await daily(job, out));
  if (due.includes("weekly")) done.push(await period(job, out, "weekly"));
  if (due.includes("monthly")) done.push(await period(job, out, "monthly"));
  out.summary = `${done.join(" ")}${refreshed ? ` Refreshed ${refreshed} reading${refreshed === 1 ? "" : "s"}.` : ""}`;
  return out;
}
