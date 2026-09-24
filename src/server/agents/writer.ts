import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import { db, comments, contentIdeas, memberships, posts, workflowRuns, workflowRunSteps } from "@/lib/db";
import type { EffectiveRule } from "@/lib/playbook/check";
import { openSlots } from "@/lib/agents/slots";
import { getBrandPlaybook } from "@/server/playbook";
import { ideaForBrand } from "@/server/ideas";
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
  const perWeek = num(s.perWeek, postRule?.limits.perWeek ?? 5, 1, 21);
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

  if (slots.length === 0) {
    out.summary = [
      revised ? `Revised ${revised} post${revised === 1 ? "" : "s"}.` : "",
      `The next ${daysAhead} days are already planned.`,
      adopted ? `Moved ${adopted} earlier post${adopted === 1 ? "" : "s"} into the review inbox.` : "",
    ].filter(Boolean).join(" ");
    return out;
  }

  /* ------------------------------------------------ 3. the next ideas */
  // The plans this brand works from: those of the people who run it.
  const owners = (await db.select({ userId: memberships.userId }).from(memberships)
    .where(and(eq(memberships.brandId, brand.id), inArray(memberships.role, ["owner", "admin"])))).map((m) => m.userId);
  const told = (await db.select({ ideaId: posts.ideaId }).from(posts)
    .where(and(eq(posts.brandId, brand.id), ne(posts.status, "failed"))))
    .flatMap((r) => (r.ideaId ? [r.ideaId] : []));
  const candidates = owners.length
    ? await db.select().from(contentIdeas).where(and(
        inArray(contentIdeas.ownerId, owners),
        isNull(contentIdeas.archivedAt),
        inArray(contentIdeas.status, ["planned", "backlog"]),
        told.length ? notInArray(contentIdeas.id, told) : undefined,
      ))
      .orderBy(asc(contentIdeas.sequence))
      .limit(40)
    : [];
  // Planned before backlog, each in plan order.
  candidates.sort((a, b) => (a.status === b.status ? a.sequence - b.sequence : a.status === "planned" ? -1 : 1));

  let written = 0;
  for (const candidate of candidates) {
    if (done >= perRun || written >= slots.length) break;
    const mine = await ideaForBrand(candidate.id, brand.id);
    if (!mine || mine.skipped) continue;

    const run = await startRun({
      brandId: brand.id, code: "publish-post", startedBy: "writer",
      context: { ideaId: candidate.id, slot: slots[written].toISOString() },
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
    }
    done++;
  }

  const open = slots.length - written;
  if (written === 0 && open > 0 && done < perRun) {
    out.issues.push(`${open} open slot${open === 1 ? "" : "s"} in the next ${daysAhead} days, and no planned or backlog idea left that this brand has not told. Add ideas to the content plan.`);
  }
  out.summary = [
    revised ? `Revised ${revised} sent-back post${revised === 1 ? "" : "s"}.` : "",
    written ? `Wrote ${written} new post${written === 1 ? "" : "s"}.` : "",
    open > 0 && written > 0 ? `${open} slot${open === 1 ? "" : "s"} still open for later runs.` : "",
    adopted ? `Moved ${adopted} earlier post${adopted === 1 ? "" : "s"} into the review inbox.` : "",
  ].filter(Boolean).join(" ") || "Nothing to write.";
  return out;
}
