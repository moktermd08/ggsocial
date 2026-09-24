import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, max, ne, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  db, activity, channels, contentIdeas, goals, ideaVersions, memberships, posts,
} from "@/lib/db";
import { METRIC_META } from "@/lib/goals/meta";
import { POST_TYPES } from "@/lib/templates";
import { platformOrNull } from "@/lib/platforms";
import { askClaude } from "@/server/agents/claude";
import type { StepContext, StepResult, WorkflowImpl } from "@/server/workflows/types";

/**
 * "Plan new ideas": the content strategist's work, as a workflow.
 *
 *   propose → the agent writes new ideas for what the brand's goals need,
 *             from the brand book and the lessons of past posts
 *   add     → the ideas join the end of the plan as planned, for this brand
 *
 * With review on for "propose" (the default) the ideas wait in the Review
 * inbox; approving adds them. The writer then takes them in plan order.
 */

const DAY = 86_400_000;

export const IdeaSchema = z.object({
  title: z.string().describe("A short working title."),
  pillar: z.string().describe("The theme it sits under. Reuse one of the brand's pillars where it fits."),
  problem: z.string().describe("The problem, as the reader lives it — the hook."),
  action: z.string().describe("What gets done about it, concretely."),
  outcome: z.string().describe("The result, with a real detail where the brand book gives one."),
  postType: z.enum(POST_TYPES as [string, ...string[]]),
  tone: z.string().describe("One or two words: practical, candid, playful…"),
  needsMedia: z.boolean().describe("True when the post only works with an image or video."),
  hashtags: z.array(z.string()).max(5),
  why: z.string().describe("One sentence for the reviewer: which goal or lesson this idea serves."),
});
export type ProposedIdea = z.infer<typeof IdeaSchema>;

const PlanSchema = z.object({ ideas: z.array(IdeaSchema) });

const SYSTEM = `You are the content strategist for one brand. You keep its content plan ahead of the calendar: when it runs short, you propose the next ideas the brand's writer will turn into posts.

Every idea follows three beats — a problem the reader lives, what gets done about it, and the outcome — and a writer should be able to tell it without asking you anything.

What good looks like:
- Each idea serves what the brand is working towards now (its goals) or builds on a lesson its own posts have taught. Say which in "why".
- Specific beats general: a real situation from the brand's world, not a topic. "When a café runs out of oat milk at 8am" is an idea; "customer service" is not.
- A mix across the brand's pillars and formats, weighted to what has worked. Never repeat or lightly reword an idea the brand already has.
- Nothing the brand could not stand behind: no invented statistics, clients, prices or results. Where a real detail would help and the brand book has none, write the idea so it does not need one.
- Formats the brand's channels can actually carry (no video-only idea for a brand with only text channels).`;

/** The brand's plan owners: its owners, else its admins. Ideas live in their plan. */
async function planOwner(brandId: string) {
  const rows = await db.select({ userId: memberships.userId, role: memberships.role }).from(memberships)
    .where(and(eq(memberships.brandId, brandId), inArray(memberships.role, ["owner", "admin"])));
  return (rows.find((r) => r.role === "owner") ?? rows[0])?.userId ?? null;
}

/**
 * Ideas this brand could still tell: planned or backlog ideas in its owners'
 * plans that it has neither told nor skipped. The writer draws on exactly these.
 */
export async function unusedIdeas(brandId: string) {
  const owners = (await db.select({ userId: memberships.userId }).from(memberships)
    .where(and(eq(memberships.brandId, brandId), inArray(memberships.role, ["owner", "admin"])))).map((m) => m.userId);
  if (owners.length === 0) return [];
  const told = (await db.select({ ideaId: posts.ideaId }).from(posts)
    .where(and(eq(posts.brandId, brandId), ne(posts.status, "failed"), isNotNull(posts.ideaId)))).map((r) => r.ideaId!);
  const skipped = (await db.select({ ideaId: ideaVersions.ideaId }).from(ideaVersions)
    .where(and(eq(ideaVersions.brandId, brandId), eq(ideaVersions.skipped, true)))).map((r) => r.ideaId);
  const exclude = [...new Set([...told, ...skipped])];
  return db.select({ id: contentIdeas.id, title: contentIdeas.title, problem: contentIdeas.problem }).from(contentIdeas).where(and(
    inArray(contentIdeas.ownerId, owners), isNull(contentIdeas.archivedAt),
    inArray(contentIdeas.status, ["planned", "backlog"]),
    exclude.length ? notInArray(contentIdeas.id, exclude) : undefined,
  ));
}

/** What the strategist reads before proposing: goals, lessons, what exists, what the channels carry. */
async function briefing(brandId: string) {
  const since = new Date(Date.now() - 120 * DAY);
  const [active, lessons, recent, existing, chans] = await Promise.all([
    db.select().from(goals).where(and(eq(goals.brandId, brandId), eq(goals.status, "active"))),
    db.select({ title: posts.title, keyLearning: posts.keyLearning }).from(posts)
      .where(and(eq(posts.brandId, brandId), isNotNull(posts.keyLearning), gte(posts.updatedAt, since)))
      .orderBy(desc(posts.updatedAt)).limit(15),
    db.select({ title: posts.title, postType: posts.postType }).from(posts)
      .where(and(eq(posts.brandId, brandId), inArray(posts.status, ["published", "partially_published", "scheduled"])))
      .orderBy(desc(posts.scheduledAt)).limit(20),
    unusedIdeas(brandId),
    db.select({ platform: channels.platform }).from(channels).where(and(eq(channels.brandId, brandId), isNull(channels.archivedAt))),
  ]);
  const owner = await planOwner(brandId);
  const pillars = owner
    ? (await db.selectDistinct({ pillar: contentIdeas.pillar }).from(contentIdeas)
        .where(and(eq(contentIdeas.ownerId, owner), isNotNull(contentIdeas.pillar)))).map((r) => r.pillar!).slice(0, 12)
    : [];
  const everIdeas = owner
    ? await db.select({ title: contentIdeas.title, problem: contentIdeas.problem }).from(contentIdeas)
        .where(eq(contentIdeas.ownerId, owner)).orderBy(desc(contentIdeas.createdAt)).limit(60)
    : [];
  return { active, lessons, recent, existing, pillars, everIdeas, platforms: [...new Set(chans.map((c) => platformOrNull(c.platform)?.name ?? c.platform))] };
}

async function propose(ctx: StepContext): Promise<StepResult> {
  const { run, brand } = ctx;
  const count = Math.max(1, Math.min(10, Number(run.context.count) || 5));
  const b = await briefing(brand.id);
  const guidelines = typeof run.context.guidelines === "string" ? run.context.guidelines : null;

  const task = [
    guidelines?.trim() ? `Standing guidelines from the brand's team (follow these):\n${guidelines.trim()}\n` : "",
    `Propose ${count} new idea${count === 1 ? "" : "s"}.`,
    b.active.length
      ? `\nWhat the brand is working towards:\n${b.active.map((g) => `- ${g.name}: ${METRIC_META[g.metric]?.label ?? g.metric} to ${g.targetValue}${g.platform ? ` on ${platformOrNull(g.platform)?.name ?? g.platform}` : ""} by ${g.deadline}`).join("\n")}`
      : "\nThe brand has no active goals; aim for steady reach and conversation.",
    b.platforms.length ? `\nIts channels: ${b.platforms.join(", ")}.` : "",
    b.pillars.length ? `\nIts content pillars so far: ${b.pillars.join("; ")}.` : "",
    b.lessons.length ? `\nLessons from its own posts (build on these):\n${b.lessons.map((l) => `- "${l.title}": ${l.keyLearning}`).join("\n")}` : "",
    b.recent.length ? `\nRecently published or booked (do not repeat):\n${b.recent.map((p) => `- ${p.title}${p.postType ? ` (${p.postType})` : ""}`).join("\n")}` : "",
    b.everIdeas.length ? `\nIdeas already in the plan, used or not (never repeat or reword these):\n${b.everIdeas.map((i) => `- ${i.title || i.problem}`).join("\n")}` : "",
    ctx.feedback ? `\nA person reviewed your last proposal and asked for this — do it:\n${ctx.feedback}` : "",
  ].filter(Boolean).join("\n");

  const { output, usage } = await askClaude({ schema: PlanSchema, system: SYSTEM, brand, task, source: "workflow:plan-ideas" });
  const seen = new Set(b.everIdeas.map((i) => (i.title || i.problem).trim().toLowerCase()));
  const ideas = output.ideas.filter((i) => !seen.has(i.title.trim().toLowerCase())).slice(0, count);
  if (ideas.length === 0) throw new Error("The strategist came back with no new ideas.");

  return {
    outcome: "done",
    summary: `Proposed ${ideas.length} new idea${ideas.length === 1 ? "" : "s"} for the plan.`,
    output: { ideas },
    context: { ideas },
    usage,
    href: "/ideas",
    review: {
      kind: "set of content ideas for the brand's plan",
      text: ideas.map((i, n) => `${n + 1}. ${i.title} [${i.postType}, ${i.pillar}]\nProblem: ${i.problem}\nAction: ${i.action}\nOutcome: ${i.outcome}`).join("\n\n"),
      screen: ideas.flatMap((i) => [i.title, i.problem, i.action, i.outcome]),
    },
  };
}

async function add(ctx: StepContext): Promise<StepResult> {
  const { run, brand } = ctx;
  const ideas = (Array.isArray(run.context.ideas) ? run.context.ideas : []) as ProposedIdea[];
  if (ideas.length === 0) return { outcome: "cancel", summary: "There were no ideas to add." };
  if (run.context.added) return { outcome: "done", summary: "Already added." };
  const owner = await planOwner(brand.id);
  if (!owner) return { outcome: "cancel", summary: "The brand has no owner whose plan the ideas could go in." };

  const [{ top }] = await db.select({ top: max(contentIdeas.sequence) }).from(contentIdeas).where(eq(contentIdeas.ownerId, owner));
  // The plan is shared by every brand its owner runs; these ideas were written for this one.
  const others = (await db.selectDistinct({ brandId: memberships.brandId }).from(memberships)
    .where(and(eq(memberships.userId, owner), inArray(memberships.role, ["owner", "admin"]), ne(memberships.brandId, brand.id))))
    .map((r) => r.brandId);

  const ids: string[] = [];
  for (const [n, i] of ideas.entries()) {
    const [row] = await db.insert(contentIdeas).values({
      ownerId: owner, sequence: (top ?? 0) + n + 1, pillar: i.pillar,
      title: i.title, problem: i.problem, action: i.action, outcome: i.outcome,
      postType: i.postType, tone: i.tone, needsMedia: i.needsMedia, hashtags: i.hashtags.map((h) => h.replace(/^#/, "")),
      status: "planned", notes: `Proposed by the content strategist agent for ${brand.name}: ${i.why}`,
    }).returning({ id: contentIdeas.id });
    ids.push(row.id);
    for (const other of others) {
      await db.insert(ideaVersions).values({
        ideaId: row.id, brandId: other, title: i.title, problem: i.problem, skipped: true,
        notes: `Written for ${brand.name}; skipped here unless you choose to tell it.`,
      }).onConflictDoNothing();
    }
  }
  await db.insert(activity).values({
    brandId: brand.id, actorId: null, action: "agent.ideas_added", entity: "idea", entityId: null,
    meta: { agent: "strategist", workflowRun: run.id, ideas: ids },
  });
  return {
    outcome: "done", summary: `Added ${ids.length} idea${ids.length === 1 ? "" : "s"} to the plan.`,
    output: { ideaIds: ids }, context: { added: true },
  };
}

export const planIdeas: WorkflowImpl = { handlers: { propose, add } };
