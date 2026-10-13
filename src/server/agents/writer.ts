import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import { db, comments, contentIdeas, memberships, posts, workflowRuns, workflowRunSteps } from "@/lib/db";
import type { EffectiveRule } from "@/lib/playbook/check";
import { openSlots } from "@/lib/agents/slots";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { resolveSchedule } from "@/lib/posting-schedule";
import { parsePin } from "@/lib/pin";
import { getBrandPlaybook } from "@/server/playbook";
import { ideaForBrand, ideaVisibleToBrand } from "@/server/ideas";
import { pillarLifts } from "@/server/performance";
import { weeklyVolume } from "@/server/volume";
import { brandCampaigns } from "@/server/campaign-plan";
import { dayInWindow, isBookable } from "@/lib/campaign-window";
import { todayIn } from "@/lib/activities/periods";
import { writerChannels } from "@/server/workflows/publish-post";
import { advance, runsForSubjects, startRun } from "@/server/workflows";
import { addUsage } from "@/server/agents/claude";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The content writer starts the "publish a planned post" workflow: one run
 * per open posting slot, each with the next idea from the content plan. The
 * run's first step — writing the post — happens here, inside the agent's
 * tick; what follows (review, media, scheduling, publishing) is the
 * workflow's, and stops for a person wherever the brand's settings say.
 */

const DAY = 86_400_000;

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/**
 * Posts the writer made before workflows existed get a run of their own, so
 * they show up in the review inbox and carry on the same way as new ones.
 */
async function adoptOldPosts(brandId: string) {
  const old = await db.select().from(posts).where(and(
    eq(posts.brandId, brandId), eq(posts.agentCode, "writer"), inArray(posts.status, ["in_review", "changes_requested"]),
  ));
  if (old.length === 0) return 0;
  const owned = new Set((await runsForSubjects("post", old.map((p) => p.id))).map((r) => r.subjectId));
  let adopted = 0;
  for (const post of old) {
    if (owned.has(post.id)) continue;
    const subject = { type: "post", id: post.id };
    const run = await startRun({ brandId, code: "publish-post", startedBy: "writer", subject });
    if (post.status === "in_review") {
      await db.insert(workflowRunSteps).values({
        runId: run.id, brandId, stepKey: "draft", status: "paused", summary: `Wrote "${post.title}".`,
        pause: {
          kind: "review", question: "Approve this post, or send it back with a note.",
          reasons: ["Review is on for this step."], href: `/posts/${post.id}`, after: true, sendBackTo: "draft",
        },
      });
      await db.update(workflowRuns).set({ status: "waiting_review", nextAt: null, summary: `Wrote "${post.title}".` })
        .where(eq(workflowRuns.id, run.id));
    } else {
      const [note] = await db.select().from(comments)
        .where(and(eq(comments.postId, post.id), eq(comments.kind, "changes_requested")))
        .orderBy(desc(comments.createdAt)).limit(1);
      await db.update(workflowRuns).set({ feedback: note?.body ?? null, revisions: 1 }).where(eq(workflowRuns.id, run.id));
    }
    adopted++;
  }
  return adopted;
}

export { goalPostsPerWeek } from "@/server/volume";

export async function runWriter(job: AgentJob): Promise<AgentOutcome> {
  const { brand, config } = job;
  const s = config.settings ?? {};
  const perRun = job.limit ?? num(s.perRun, 2, 1, 5);
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };

  const adopted = await adoptOldPosts(brand.id);

  /* ------------------------------------------ 1. runs sent back to it */
  // Revisions are the workflow's; the writer gives them its tick so they
  // happen as soon as they would have before.
  const sentBack = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(and(
    eq(workflowRuns.brandId, brand.id), eq(workflowRuns.workflowCode, "publish-post"),
    eq(workflowRuns.status, "running"), eq(workflowRuns.stepIndex, 0), lte(workflowRuns.nextAt, job.now),
  )).orderBy(asc(workflowRuns.nextAt)).limit(perRun);
  let done = 0, revised = 0;
  for (const { id } of sentBack) {
    const report = await advance(id, { agentSteps: true, now: job.now });
    if (!report) continue;
    for (const step of report.steps) {
      if (step.usage) out.usage = addUsage(out.usage, step.usage);
      if (step.outcome === "failed") out.issues.push(step.summary);
    }
    if (report.run.subjectId) out.items.push({ kind: "post", id: report.run.subjectId, label: report.run.summary ?? "Revised a post", href: `/posts/${report.run.subjectId}` });
    revised++;
    done++;
  }
  if (done >= perRun) {
    out.summary = `Revised ${revised} post${revised === 1 ? "" : "s"} sent back by a reviewer.`;
    return out;
  }

  /* ----------------------------------------------- 2. open posting slots */
  const chanRows = await writerChannels(brand.id, s.channelIds);
  if (chanRows.length === 0) {
    out.issues.push("This brand has no channels for the writer to write for. Add a channel, or tick some in the writer's settings.");
    out.summary = revised ? `Revised ${revised} post${revised === 1 ? "" : "s"}; no channels to write new ones for.` : "No channels to write for.";
    return out;
  }

  const playbook = await getBrandPlaybook(brand.id);
  const postRule: EffectiveRule | undefined = playbook.find((r) => r.code === "post" && r.enabled);
  const daysAhead = num(s.daysAhead, 7, 1, 30);
  // One answer for how many a week, shared with the strategist and the calendar forecast.
  const { perWeek } = await weeklyVolume(brand.id, job.now);
  const now = new Date();
  const taken = await db.select({ at: posts.scheduledAt }).from(posts).where(and(
    eq(posts.brandId, brand.id),
    notInArray(posts.status, ["failed"]),
    gte(posts.scheduledAt, new Date(now.getTime() - 8 * DAY)),
    lte(posts.scheduledAt, new Date(now.getTime() + (daysAhead + 2) * DAY)),
  ));
  const slots = openSlots({
    timezone: brand.timezone, now, daysAhead, perWeek,
    days: postRule?.limits.days, windows: postRule?.limits.windows,
    taken: taken.flatMap((t) => (t.at ? [t.at] : [])),
  });

  /* ------------------------------------------------ 3. the next ideas */
  // The plans this brand works from: those of the people who run it.
  const owners = (await db.select({ userId: memberships.userId }).from(memberships)
    .where(and(eq(memberships.brandId, brand.id), inArray(memberships.role, ["owner", "admin"])))).map((m) => m.userId);
  const told = (await db.select({ ideaId: posts.ideaId }).from(posts)
    .where(and(eq(posts.brandId, brand.id), ne(posts.status, "failed"))))
    .flatMap((r) => (r.ideaId ? [r.ideaId] : []));
  let candidates = owners.length
    ? await db.select().from(contentIdeas).where(and(
        inArray(contentIdeas.ownerId, owners),
        isNull(contentIdeas.archivedAt),
        ideaVisibleToBrand(brand.id),
        inArray(contentIdeas.status, ["planned", "backlog"]),
        told.length ? notInArray(contentIdeas.id, told) : undefined,
      ))
      .orderBy(asc(contentIdeas.sequence))
      .limit(40)
    : [];
  // Ideas made for a campaign are told only while it can be: not before it is set up, not once it is paused or over.
  // An idea whose campaign no longer exists is just an idea.
  const today = todayIn(brand.timezone, now);
  const campaignRows = await brandCampaigns(brand.id);
  const bookable = new Map(campaignRows.filter((c) => isBookable(c, today)).map((c) => [c.name, c]));
  const known = new Set(campaignRows.map((c) => c.name));
  candidates = candidates.filter((c) => !c.campaign || bookable.has(c.campaign) || !known.has(c.campaign));
  const campaignEnd = (c: (typeof candidates)[number]) => (c.campaign && bookable.has(c.campaign) ? bookable.get(c.campaign)!.endDate ?? "9999-12-31" : null);

  // Campaign ideas first, the one ending soonest first. Then planned before backlog. A person's plan keeps its order;
  // the backlog has no order of its own, so it is worked through best-performing topic first, then in plan order.
  const lifts = await pillarLifts(brand.id);
  const lift = (c: (typeof candidates)[number]) => (c.pillar ? lifts.get(c.pillar) ?? 1 : 1);
  candidates.sort((a, b) => {
    const ca = campaignEnd(a), cb = campaignEnd(b);
    if (ca && cb && ca !== cb) return ca < cb ? -1 : 1;
    if (Boolean(ca) !== Boolean(cb)) return ca ? -1 : 1;
    return a.status === b.status
      ? (a.status === "backlog" && lift(a) !== lift(b) ? lift(b) - lift(a) : a.sequence - b.sequence)
      : a.status === "planned" ? -1 : 1;
  });

  // Ideas pinned to a day by dragging them on the calendar are booked for that
  // day, once it is within reach; the rest take the open slots in plan order.
  const tomorrow = toLocalInput(new Date(now.getTime() + DAY), brand.timezone).slice(0, 10);
  const lastDay = toLocalInput(new Date(now.getTime() + daysAhead * DAY), brand.timezone).slice(0, 10);
  const usual = resolveSchedule({ postRule: postRule?.limits }).times[0];
  const plan: { candidate: (typeof candidates)[number]; slot: Date; pinned: boolean }[] = [];
  for (const c of candidates) {
    const pin = parsePin(c.plannedFor);
    if (!pin || pin.day < tomorrow || pin.day > lastDay) continue;
    const slot = fromLocalInput(`${pin.day}T${pin.time ?? usual}`, brand.timezone);
    if (slot) plan.push({ candidate: c, slot, pinned: true });
  }
  const pinnedIds = new Set(plan.map((p) => p.candidate.id));
  // The rest take the open slots, a campaign's idea only one that falls inside the campaign's dates.
  const open = [...slots];
  for (const candidate of candidates.filter((c) => !pinnedIds.has(c.id))) {
    if (open.length === 0) break;
    const camp = candidate.campaign ? bookable.get(candidate.campaign) : undefined;
    const at = camp ? open.findIndex((s) => dayInWindow(camp, toLocalInput(s, brand.timezone).slice(0, 10))) : 0;
    if (at < 0) continue;
    plan.push({ candidate, slot: open.splice(at, 1)[0], pinned: false });
  }

  // Nothing open and nothing pinned for these days.
  if (plan.length === 0 && slots.length === 0) {
    out.summary = [
      revised ? `Revised ${revised} post${revised === 1 ? "" : "s"}.` : "",
      `The next ${daysAhead} days are already planned.`,
      adopted ? `Moved ${adopted} earlier post${adopted === 1 ? "" : "s"} into the review inbox.` : "",
    ].filter(Boolean).join(" ");
    return out;
  }

  let written = 0, freeWritten = 0;
  for (const { candidate, slot, pinned } of plan) {
    if (done >= perRun) break;
    const mine = await ideaForBrand(candidate.id, brand.id);
    if (!mine || mine.skipped) continue;

    const run = await startRun({
      brandId: brand.id, code: "publish-post", startedBy: "writer",
      context: { ideaId: candidate.id, slot: slot.toISOString() },
    });
    const report = await advance(run.id, { agentSteps: true, now: job.now });
    if (!report) continue;
    for (const step of report.steps) {
      if (step.usage) out.usage = addUsage(out.usage, step.usage);
      if (step.outcome === "failed") out.issues.push(`${candidate.title}: ${step.summary}`);
    }
    const postId = report.run.subjectId;
    if (postId) {
      const stopped = report.run.status === "waiting_review" ? "waiting for review" : report.run.status === "waiting_human" ? "waiting for a person" : "on its way";
      out.items.push({ kind: "post", id: postId, label: `${report.run.summary ?? candidate.title} — ${stopped}`, href: `/posts/${postId}` });
      written++;
      if (!pinned) freeWritten++;
    }
    done++;
  }

  const stillOpen = slots.length - freeWritten;
  if (written === 0 && stillOpen > 0 && done < perRun) {
    out.issues.push(`${stillOpen} open slot${stillOpen === 1 ? "" : "s"} in the next ${daysAhead} days, and no planned or backlog idea left that this brand has not told. Add ideas to the content plan.`);
  }
  out.summary = [
    revised ? `Revised ${revised} sent-back post${revised === 1 ? "" : "s"}.` : "",
    written ? `Wrote ${written} new post${written === 1 ? "" : "s"}.` : "",
    stillOpen > 0 && freeWritten > 0 ? `${stillOpen} slot${stillOpen === 1 ? "" : "s"} still open for later runs.` : "",
    adopted ? `Moved ${adopted} earlier post${adopted === 1 ? "" : "s"} into the review inbox.` : "",
  ].filter(Boolean).join(" ") || "Nothing to write.";
  return out;
}
