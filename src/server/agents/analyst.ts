import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, activity, activityChecks, activityTemplates, channels, metrics, posts, postTargets } from "@/lib/db";
import { platformOrNull } from "@/lib/platforms";
import { localClock } from "@/lib/playbook/check";
import { toLocalInput } from "@/lib/format";
import { periodFor, todayIn } from "@/lib/activities/periods";
import { agentActorName } from "@/lib/agents/meta";
import { ensureActivityLibrary, recordCheck } from "@/server/activities";
import { refreshMetrics } from "@/server/publish";
import { askClaude } from "@/server/agents/claude";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The performance analyst: once a day, from 07:00 brand time, it pulls fresh
 * numbers, reads yesterday's posts against the brand's last 30 days, and
 * ticks the daily "glance at yesterday's performance" check with its note —
 * which then waits for a person's review like any other check.
 */

const CHECK_CODE = "D-16";
const START_MINUTE = 7 * 60;
const DAY = 86_400_000;

const SYSTEM = `You are the analyst on a brand's social media team. Each morning you read yesterday's posts against the brand's own recent numbers and tell the team, in plain words, what stood out.

What good looks like:
- Compare with the brand's usual, not with the wider internet: a post is good or bad against the 30-day typical for its platform.
- Engagement rate (likes, comments, shares and saves over reach or impressions) and clicks matter more than raw reach. Saves and shares signal content worth repeating.
- Say what probably caused a result only when the posts give you a reason to think so; otherwise say it is too early to tell.
- One concrete thing to try next, tied to what you saw.
- Where a platform shares no numbers, say so once rather than guessing.
- Keep the note short enough to read in thirty seconds.`;

const ReportSchema = z.object({
  note: z.string().describe("Three to five sentences for the team: what stood out yesterday against the usual, and one thing to try."),
  standouts: z.array(z.object({
    postId: z.string(),
    learning: z.string().describe("One sentence: what this post teaches, to keep on the post."),
  })).describe("Only posts clearly above or below the usual. Often empty."),
});

type Numbers = { impressions: number; reach: number; engagements: number; clicks: number };

const engagementsOf = (m: typeof metrics.$inferSelect) => m.likes + m.commentCount + m.shares + m.saves;

/** True once it is past 07:00 brand time and today's check has not been done. */
export async function analystDue(brandId: string, timezone: string, now: Date) {
  if (localClock(now.toISOString(), timezone).minute < START_MINUTE) return false;
  await ensureActivityLibrary();
  const template = await db.query.activityTemplates.findFirst({ where: eq(activityTemplates.code, CHECK_CODE) });
  if (!template) return false;
  const period = periodFor(template.frequency, todayIn(timezone, now));
  const existing = await db.query.activityChecks.findFirst({
    where: and(eq(activityChecks.brandId, brandId), eq(activityChecks.templateId, template.id), eq(activityChecks.periodKey, period.key)),
    columns: { id: true },
  });
  return !existing;
}

export async function runAnalyst(job: AgentJob): Promise<AgentOutcome> {
  const { brand, config, now } = job;
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };
  const today = todayIn(brand.timezone, now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

  const refreshed = await refreshMetrics(brand.id, 30);

  // Everything published in the last 31 days, with its latest reading.
  const since = new Date(now.getTime() - 31 * DAY);
  const published = await db.select({ target: postTargets, post: posts, platform: channels.platform })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(eq(posts.brandId, brand.id), eq(postTargets.status, "published"), gte(postTargets.publishedAt, since)));

  const latest = new Map<string, typeof metrics.$inferSelect>();
  if (published.length) {
    const rows = await db.select().from(metrics)
      .where(inArray(metrics.targetId, published.map((p) => p.target.id)))
      .orderBy(desc(metrics.fetchedAt));
    for (const m of rows) if (!latest.has(m.targetId)) latest.set(m.targetId, m);
  }

  const localDate = (d: Date | null) => (d ? toLocalInput(d, brand.timezone).slice(0, 10) : "");
  const fromYesterday = published.filter((p) => localDate(p.target.publishedAt) === yesterday);

  if (fromYesterday.length === 0) {
    const notes = "Nothing was published yesterday, so there is nothing new to read.";
    await recordCheck({ brandId: brand.id, code: CHECK_CODE, date: today, status: "done", notes },
      { kind: "ai", name: agentActorName("analyst"), userId: null }, "auto");
    out.items.push({ kind: "check", id: null, label: `${CHECK_CODE}: ${notes}`, href: "/activities" });
    out.summary = `${notes}${refreshed ? ` Refreshed ${refreshed} reading${refreshed === 1 ? "" : "s"}.` : ""}`;
    return out;
  }

  // The 30-day typical per platform, from posts before yesterday.
  const typical = new Map<string, Numbers & { n: number }>();
  for (const p of published) {
    if (localDate(p.target.publishedAt) >= yesterday) continue;
    const m = latest.get(p.target.id);
    if (!m) continue;
    const t = typical.get(p.platform) ?? { impressions: 0, reach: 0, engagements: 0, clicks: 0, n: 0 };
    t.impressions += m.impressions; t.reach += m.reach; t.engagements += engagementsOf(m); t.clicks += m.clicks; t.n++;
    typical.set(p.platform, t);
  }

  const lines = fromYesterday.map((p) => {
    const m = latest.get(p.target.id);
    const name = platformOrNull(p.platform)?.name ?? p.platform;
    const t = typical.get(p.platform);
    const avg = t && t.n ? `typical here: ${Math.round(t.impressions / t.n)} impressions, ${Math.round(t.reach / t.n)} reach, ${Math.round(t.engagements / t.n)} engagements, ${Math.round(t.clicks / t.n)} clicks over ${t.n} posts` : "no earlier numbers on this platform";
    const got = m ? `${m.impressions} impressions, ${m.reach} reach, ${m.likes} likes, ${m.commentCount} comments, ${m.shares} shares, ${m.saves} saves, ${m.clicks} clicks` : "no numbers from this platform";
    return `- postId: ${p.post.id} | ${name} | "${p.post.title || p.post.body.slice(0, 60)}"${p.post.postType ? ` (${p.post.postType})` : ""}\n  got: ${got}\n  ${avg}`;
  });

  const task = [
    config.guidelines?.trim() ? `Standing guidelines from the brand's team (follow these):\n${config.guidelines.trim()}\n` : "",
    `Yesterday (${yesterday}) the brand published:`,
    ...lines,
  ].filter(Boolean).join("\n");

  const { output, usage } = await askClaude({ schema: ReportSchema, system: SYSTEM, brand, task, effort: "low" });
  out.usage = usage;

  // A lesson goes on a standout post only where nobody has written one.
  const ids = new Set(fromYesterday.map((p) => p.post.id));
  let learned = 0;
  for (const s of output.standouts) {
    if (!ids.has(s.postId) || !s.learning.trim()) continue;
    const post = fromYesterday.find((p) => p.post.id === s.postId)!.post;
    if (post.keyLearning?.trim()) continue;
    await db.update(posts).set({ keyLearning: s.learning.trim(), updatedAt: new Date() }).where(eq(posts.id, s.postId));
    out.items.push({ kind: "post", id: s.postId, label: `Lesson noted on "${post.title || "a post"}"`, href: `/posts/${s.postId}` });
    learned++;
  }

  await recordCheck({ brandId: brand.id, code: CHECK_CODE, date: today, status: "done", count: fromYesterday.length, notes: output.note },
    { kind: "ai", name: agentActorName("analyst"), userId: null }, "auto");
  await db.insert(activity).values({
    brandId: brand.id, actorId: null, action: "agent.daily_report", entity: "brand", entityId: brand.id,
    meta: { agent: "analyst", posts: fromYesterday.length, learned, ...usage },
  });

  out.items.unshift({ kind: "note", id: null, label: output.note, href: "/activities" });
  out.summary = `Read ${fromYesterday.length} post${fromYesterday.length === 1 ? "" : "s"} from yesterday and ticked ${CHECK_CODE} for review.${learned ? ` Noted ${learned} lesson${learned === 1 ? "" : "s"}.` : ""}`;
  return out;
}
