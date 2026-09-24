import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import {
  db, activity, channels, comments, contentIdeas, memberships, posts, postTargets,
} from "@/lib/db";
import { defaultOptions, platformOrNull } from "@/lib/platforms";
import { toLocalInput } from "@/lib/format";
import type { EffectiveRule } from "@/lib/playbook/check";
import { openSlots } from "@/lib/agents/slots";
import { getBrandPlaybook } from "@/server/playbook";
import { ideaForBrand } from "@/server/ideas";
import { draftPost, type Draft, type DraftChannel } from "@/server/drafting";
import { addUsage } from "@/server/agents/claude";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The content writer: revises its own sent-back posts, then fills the open
 * posting slots from the content plan. Every post it writes lands in review
 * with its slot booked; an approver's sign-off is what schedules it.
 */

const DAY = 86_400_000;

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

async function brandChannels(brandId: string, picked: unknown): Promise<(typeof channels.$inferSelect)[]> {
  const all = await db.select().from(channels)
    .where(and(eq(channels.brandId, brandId), isNull(channels.archivedAt)));
  const ids = Array.isArray(picked) ? picked.filter((x): x is string => typeof x === "string") : [];
  return ids.length ? all.filter((c) => ids.includes(c.id)) : all;
}

function toDraftChannels(rows: (typeof channels.$inferSelect)[], options: Record<string, Record<string, unknown>> = {}): DraftChannel[] {
  return rows.map((c) => ({
    id: c.id, platform: c.platform, handle: c.handle, link: null,
    options: { ...defaultOptions(c.platform), ...(c.settings ?? {}), ...(options[c.id] ?? {}) },
  }));
}

/** Writes a draft onto a post's targets, as the composer's "draft with Claude" does. */
async function applyToTargets(draft: Draft, targets: (typeof postTargets.$inferSelect)[], chans: DraftChannel[]) {
  for (const v of draft.channels) {
    const target = targets.find((t) => t.channelId === v.channelId);
    const channel = chans.find((c) => c.id === v.channelId);
    if (!target || !channel) continue;
    const supportsFirstComment = platformOrNull(channel.platform)?.constraints.supportsFirstComment;
    await db.update(postTargets).set({
      bodyOverride: v.body,
      firstComment: supportsFirstComment ? v.firstComment : target.firstComment,
    }).where(eq(postTargets.id, target.id));
  }
}

const reviewNote = (draft: Draft, issues: string[]) => [
  `Written by the content writer agent. ${draft.note}`.trim(),
  issues.length ? `Still to fix before approval:\n${issues.map((i) => `- ${i}`).join("\n")}` : "",
].filter(Boolean).join("\n\n");

export async function runWriter(job: AgentJob): Promise<AgentOutcome> {
  const { brand, config } = job;
  const s = config.settings ?? {};
  const perRun = job.limit ?? num(s.perRun, 2, 1, 5);
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };
  let done = 0;
  const playbook = await getBrandPlaybook(brand.id);

  /* ------------------------------------------ 1. posts sent back to it */
  const sentBack = await db.select().from(posts)
    .where(and(eq(posts.brandId, brand.id), eq(posts.agentCode, "writer"), eq(posts.status, "changes_requested")))
    .orderBy(asc(posts.scheduledAt))
    .limit(perRun);
  let revised = 0;
  for (const post of sentBack) {
    const [note] = await db.select().from(comments)
      .where(and(eq(comments.postId, post.id), eq(comments.kind, "changes_requested")))
      .orderBy(desc(comments.createdAt)).limit(1);
    const targets = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
    const chanRows = targets.length
      ? await db.select().from(channels).where(inArray(channels.id, targets.map((t) => t.channelId)))
      : [];
    const chans = toDraftChannels(chanRows, Object.fromEntries(targets.map((t) => [t.channelId, t.options])));
    const idea = post.ideaId ? (await ideaForBrand(post.ideaId, brand.id))?.idea ?? null : null;

    const result = await draftPost({
      brand, idea, title: post.title, body: post.body, channels: chans, playbook, postType: post.postType,
      guidelines: config.guidelines,
      feedback: note?.body ?? "The reviewer requested changes without a note. Tighten the hook and check it against the playbook.",
    });
    out.usage = addUsage(out.usage, result.usage);
    await db.update(posts).set({
      title: result.draft.title, body: result.draft.body, status: "in_review",
      notes: reviewNote(result.draft, result.issues), updatedAt: new Date(),
    }).where(eq(posts.id, post.id));
    await applyToTargets(result.draft, targets, chans);
    await db.insert(comments).values({
      postId: post.id, userId: null,
      body: `Content writer agent: revised to address the review${note ? "" : " (no note was left)"}. ${result.draft.note}`.trim(),
    });
    await db.insert(activity).values({
      brandId: brand.id, actorId: null, action: "agent.post_revised", entity: "post", entityId: post.id,
      meta: { agent: "writer", ...result.usage },
    });
    out.items.push({ kind: "post", id: post.id, label: `Revised: ${result.draft.title}`, href: `/posts/${post.id}` });
    out.issues.push(...result.issues.map((i) => `${result.draft.title}: ${i}`));
    revised++;
    done++;
  }

  /* ----------------------------------------------- 2. open posting slots */
  if (done >= perRun) {
    out.summary = `Revised ${revised} post${revised === 1 ? "" : "s"} sent back by a reviewer.`;
    return out;
  }

  const chanRows = await brandChannels(brand.id, s.channelIds);
  if (chanRows.length === 0) {
    out.issues.push("This brand has no channels for the writer to write for. Add a channel, or tick some in the writer's settings.");
    out.summary = revised ? `Revised ${revised} post${revised === 1 ? "" : "s"}; no channels to write new ones for.` : "No channels to write for.";
    return out;
  }

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
    out.summary = revised
      ? `Revised ${revised} post${revised === 1 ? "" : "s"}. The next ${daysAhead} days are already planned.`
      : `The next ${daysAhead} days are already planned.`;
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

  const chans = toDraftChannels(chanRows);
  let written = 0;
  for (const candidate of candidates) {
    if (done >= perRun || written >= slots.length) break;
    const mine = await ideaForBrand(candidate.id, brand.id);
    if (!mine || mine.skipped) continue;
    const idea = mine.idea;
    const at = slots[written];

    // Draft first, so a failed call leaves no empty post behind.
    const result = await draftPost({
      brand, idea, channels: chans, playbook, postType: idea.postType, guidelines: config.guidelines,
    });
    out.usage = addUsage(out.usage, result.usage);
    const { draft } = result;

    const [post] = await db.insert(posts).values({
      brandId: brand.id, ideaId: idea.id, title: draft.title, body: draft.body,
      status: "in_review", scheduledAt: at, postType: idea.postType, tone: idea.tone,
      targetImpressions: idea.targetImpressions, agentCode: "writer",
      notes: [reviewNote(draft, result.issues), idea.needsMedia ? "This idea needs media: attach an image or video before approving." : ""].filter(Boolean).join("\n\n"),
    }).returning({ id: posts.id });

    for (const c of chanRows) {
      const v = draft.channels.find((d) => d.channelId === c.id);
      const supportsFirstComment = platformOrNull(c.platform)?.constraints.supportsFirstComment;
      await db.insert(postTargets).values({
        postId: post.id, channelId: c.id,
        bodyOverride: v?.body ?? null,
        firstComment: supportsFirstComment ? v?.firstComment ?? null : null,
        options: { ...defaultOptions(c.platform), ...(c.settings ?? {}) },
        status: "pending", scheduledAt: at,
      });
    }

    if (candidate.status === "backlog") {
      await db.update(contentIdeas).set({ status: "drafting", updatedAt: new Date() }).where(eq(contentIdeas.id, idea.id));
    }
    await db.insert(activity).values({
      brandId: brand.id, actorId: null, action: "agent.post_written", entity: "post", entityId: post.id,
      meta: { agent: "writer", ideaId: idea.id, ...result.usage },
    });

    const when = toLocalInput(at, brand.timezone).replace("T", " ");
    out.items.push({ kind: "post", id: post.id, label: `${draft.title} — for ${when}`, href: `/posts/${post.id}` });
    out.issues.push(...result.issues.map((i) => `${draft.title}: ${i}`));
    if (idea.needsMedia) out.issues.push(`${draft.title}: needs media before it can be approved.`);
    written++;
    done++;
  }

  const open = slots.length - written;
  if (written === 0 && open > 0 && done < perRun) {
    out.issues.push(`${open} open slot${open === 1 ? "" : "s"} in the next ${daysAhead} days, and no planned or backlog idea left that this brand has not told. Add ideas to the content plan.`);
  }
  out.summary = [
    revised ? `Revised ${revised} sent-back post${revised === 1 ? "" : "s"}.` : "",
    written ? `Wrote ${written} new post${written === 1 ? "" : "s"} for review.` : "",
    open > 0 && written > 0 ? `${open} slot${open === 1 ? "" : "s"} still open for later runs.` : "",
  ].filter(Boolean).join(" ") || "Nothing to write.";
  return out;
}
