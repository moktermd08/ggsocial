import "server-only";
import { and, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import {
  db, activity, attachments, brandAgents, channels, comments, contentIdeas, posts, postTargets, postVersions,
} from "@/lib/db";
import { defaultOptions, platformOrNull } from "@/lib/platforms";
import { toLocalInput, truncate } from "@/lib/format";
import { findPlaceholders } from "@/lib/templates";
import { blockingText, checkSavedPost, getBrandPlaybook } from "@/server/playbook";
import { ideaForBrand } from "@/server/ideas";
import { draftPost, type Draft, type DraftChannel } from "@/server/drafting";
import { publishTarget } from "@/server/publish";
import { snapPostTargets } from "@/server/schedule";
import { generateVersions } from "@/server/versions";
import { generatePostImages } from "@/server/media-generate";
import { platformLimitProblems, settleFormats } from "@/server/format-fit";
import { stampApproval } from "@/server/approval";
import { learningLines, recentOpenings } from "@/server/performance";
import { publishBody } from "@/server/versions";
import { FORMAT_META, type ContentFormat } from "@/lib/formats";
import { searchBrandLibrary } from "@/server/media-catalog";
import { rankForText } from "@/lib/media-catalog";
import type { StepContext, StepResult, WorkflowImpl, WorkflowRun } from "@/server/workflows/types";

/**
 * "Publish a planned post": the content writer's work, as a workflow.
 *
 *   draft    → the agent writes the post from an idea into a booked slot
 *   media    → a person attaches an image or video, only where one is needed
 *   schedule → a last check against the playbook, then every channel is booked
 *   publish  → live channels post themselves; manual ones wait in the queue
 *
 * With review on for "draft" (the default) the run stops after writing, just
 * as the writer's posts always waited for an approver. With it off, a post
 * that passes the playbook and the reviewer goes out by itself.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

/* ------------------------------------------------------------- helpers */

export async function writerConfig(brandId: string) {
  return db.query.brandAgents.findFirst({ where: and(eq(brandAgents.brandId, brandId), eq(brandAgents.agentCode, "writer")) }) ?? null;
}

/** The brand's channels, narrowed to the ones ticked in the writer's settings when any are. */
export async function writerChannels(brandId: string, picked: unknown): Promise<(typeof channels.$inferSelect)[]> {
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

/**
 * A saved post, checked: the safety reasons code can find by itself (broken
 * playbook musts, template holes), and the post laid out for the reviewer —
 * every channel's copy with the playbook points it still misses.
 */
async function inspect(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return { reasons: [], review: undefined };
  const targets = await db.select({ target: postTargets, platform: channels.platform }).from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, postId));
  const versions = await db.select().from(postVersions).where(eq(postVersions.postId, postId));
  // What each channel will really send: its adopted format's text, else its own copy.
  const sent = (t: (typeof targets)[number]) => publishBody(t.target, versions.find((v) => v.id === t.target.versionId) ?? null, post);
  const texts = [post.title, post.body, ...targets.flatMap((t) => [sent(t), t.target.firstComment])];
  const checks = (await checkSavedPost(postId)) ?? [];
  const reasons: string[] = [];
  const held = new Set((await heldForMedia(post)).map((h) => h.channelId));
  const blocked = blockingText(checks.filter((c) => !held.has(c.channelId)));
  if (blocked) reasons.push(blocked);
  const limits = await platformLimitProblems(postId, (await heldForMedia(post)).map((h) => h.id));
  if (limits.length) reasons.push(`Over a platform's limit: ${limits.join(" ")}`);
  const holes = findPlaceholders(texts.filter(Boolean).join("\n"));
  if (holes.length) reasons.push(`Template placeholders are still unfilled: ${holes.join(", ")}.`);

  const text = [
    `Working title: ${post.title}`,
    `Base copy:\n${post.body}`,
    ...targets.map(({ target, platform }) => {
      const warns = checks.find((c) => c.channelId === target.channelId)?.issues.map((i) => i.message) ?? [];
      const version = versions.find((v) => v.id === target.versionId);
      const as = target.useVersion && version ? ` (goes out as a ${FORMAT_META[version.format as ContentFormat].label.toLowerCase()})` : "";
      return [
        `--- ${platformOrNull(platform)?.name ?? platform}${as}:`,
        sent({ target, platform }) || "(base copy)",
        target.firstComment ? `First comment: ${target.firstComment}` : "",
        warns.length ? `Playbook points still open: ${warns.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    }),
  ].join("\n\n");
  return { reasons, review: { kind: "social post", text, screen: texts.filter((t): t is string => Boolean(t)) } };
}

async function loadPost(run: WorkflowRun) {
  if (run.subjectType !== "post" || !run.subjectId) return null;
  return (await db.query.posts.findFirst({ where: eq(posts.id, run.subjectId) })) ?? null;
}

/* ---------------------------------------------------------------- steps */

async function draft(ctx: StepContext): Promise<StepResult> {
  const { run, brand } = ctx;
  const config = await writerConfig(brand.id);
  const playbook = await getBrandPlaybook(brand.id);
  const existing = await loadPost(run);
  if (run.subjectId && !existing) return { outcome: "cancel", summary: "The post was deleted." };

  let postId: string;
  let title: string;
  let usage;
  if (existing) {
    // Redo for a person's note: the latest one sent with "send back", or left on the post itself.
    const [comment] = await db.select().from(comments)
      .where(and(eq(comments.postId, existing.id), eq(comments.kind, "changes_requested")))
      .orderBy(desc(comments.createdAt)).limit(1);
    const feedback = ctx.feedback ?? comment?.body
      ?? "The reviewer asked for changes without a note. Tighten the hook and check it against the playbook.";
    const targets = await db.select().from(postTargets).where(eq(postTargets.postId, existing.id));
    const chanRows = targets.length ? await db.select().from(channels).where(inArray(channels.id, targets.map((t) => t.channelId))) : [];
    const chans = toDraftChannels(chanRows, Object.fromEntries(targets.map((t) => [t.channelId, t.options])));
    const idea = existing.ideaId ? (await ideaForBrand(existing.ideaId, brand.id))?.idea ?? null : null;

    const result = await draftPost({
      brand, idea, title: existing.title, body: existing.body, channels: chans, playbook,
      postType: existing.postType, guidelines: config?.guidelines, feedback, source: "workflow:publish-post",
      learnings: await learningLines(brand.id, { platforms: chans.map((c) => c.platform) }), recentOpenings: await recentOpenings(brand.id),
    });
    await db.update(posts).set({
      title: result.draft.title, body: result.draft.body, status: "in_review",
      notes: reviewNote(result.draft, result.issues), updatedAt: new Date(),
    }).where(eq(posts.id, existing.id));
    await applyToTargets(result.draft, targets, chans);
    await db.insert(comments).values({
      postId: existing.id, userId: null,
      body: `Content writer agent: revised to address the review. ${result.draft.note}`.trim(),
    });
    await db.insert(activity).values({
      brandId: brand.id, actorId: null, action: "agent.post_revised", entity: "post", entityId: existing.id,
      meta: { agent: "writer", workflowRun: run.id, ...result.usage },
    });
    postId = existing.id;
    title = result.draft.title;
    usage = result.usage;
  } else {
    const ideaId = typeof run.context.ideaId === "string" ? run.context.ideaId : null;
    const slot = typeof run.context.slot === "string" ? new Date(run.context.slot) : null;
    if (!ideaId || !slot) return { outcome: "cancel", summary: "No idea or slot was given to write for." };
    const mine = await ideaForBrand(ideaId, brand.id);
    if (!mine || mine.skipped) return { outcome: "cancel", summary: "The idea is gone, or this brand skips it." };
    const idea = mine.idea;
    const chanRows = await writerChannels(brand.id, config?.settings?.channelIds);
    if (chanRows.length === 0) return { outcome: "cancel", summary: "This brand has no channels to write for." };
    const chans = toDraftChannels(chanRows);

    // Draft first, so a failed call leaves no empty post behind.
    const result = await draftPost({
      brand, idea, channels: chans, playbook, postType: idea.postType, guidelines: config?.guidelines, source: "workflow:publish-post",
      learnings: await learningLines(brand.id, { platforms: chans.map((c) => c.platform) }), recentOpenings: await recentOpenings(brand.id),
    });
    const d = result.draft;
    const [post] = await db.insert(posts).values({
      brandId: brand.id, ideaId: idea.id, title: d.title, body: d.body,
      status: "in_review", scheduledAt: slot, postType: idea.postType, tone: idea.tone,
      targetImpressions: idea.targetImpressions, agentCode: "writer",
      notes: [reviewNote(d, result.issues), idea.needsMedia ? "This idea needs media: attach an image or video before it can go out." : ""].filter(Boolean).join("\n\n"),
    }).returning({ id: posts.id });
    for (const c of chanRows) {
      const v = d.channels.find((x) => x.channelId === c.id);
      const supportsFirstComment = platformOrNull(c.platform)?.constraints.supportsFirstComment;
      await db.insert(postTargets).values({
        postId: post.id, channelId: c.id,
        bodyOverride: v?.body ?? null,
        firstComment: supportsFirstComment ? v?.firstComment ?? null : null,
        options: { ...defaultOptions(c.platform), ...(c.settings ?? {}) },
        status: "pending", scheduledAt: slot,
      });
    }
    const planned = await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, idea.id), columns: { status: true } });
    if (planned?.status === "backlog") {
      await db.update(contentIdeas).set({ status: "drafting", updatedAt: new Date() }).where(eq(contentIdeas.id, idea.id));
    }
    await db.insert(activity).values({
      brandId: brand.id, actorId: null, action: "agent.post_written", entity: "post", entityId: post.id,
      meta: { agent: "writer", ideaId: idea.id, workflowRun: run.id, ...result.usage },
    });
    postId = post.id;
    title = d.title;
    usage = result.usage;
  }

  // The same post in every other format its channels carry — carousel, thread,
  // reel script — so each channel has the right one ready when it is approved.
  // Turn off with the writer's "makeFormats" setting. A failure here never
  // fails the step: the post itself is already written.
  let formatNote = "";
  if (config?.settings?.makeFormats !== false) {
    try {
      const made = await generateVersions(postId, { source: "workflow:publish-post", agentCode: "writer" });
      if (made.made.length) formatNote = ` Also wrote ${made.made.length} format${made.made.length === 1 ? "" : "s"} (${made.made.join(", ")}).`;
    } catch (err) {
      formatNote = ` Could not write the other formats: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  }

  // Where the post needs an image, the best filed one goes on now, so whoever
  // approves the post sees it whole. The media step only fills a gap left here.
  const context: Record<string, unknown> = {};
  const saved = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (saved) {
    const need = await mediaNeed(saved);
    const [has] = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.postId, postId)).limit(1);
    if (need.needed && !has) {
      const tried = Array.isArray(run.context.mediaTried) ? (run.context.mediaTried as string[]) : [];
      const best = await attachBestMedia(saved, need, tried);
      if (best) Object.assign(context, { mediaPicked: best.id, mediaTried: [...tried, best.id] });
      else if (config?.settings?.makeImages !== false) {
        // Nothing filed fits: make it from the brand's Canva template rather than wait for a person.
        const made = await generatePostImages(postId);
        if (made.ok) {
          Object.assign(context, { mediaGenerated: made.mediaIds });
          formatNote += ` ${made.summary}`;
        } else {
          Object.assign(context, { mediaError: made.reason });
        }
      }
    }
  }
  // Now that the media is known, each channel takes the richest format it can really be sent in.
  const settled = await settleFormats(postId);
  const fellBack = settled.filter((s) => s.note).map((s) => `${s.channel} ${s.note}`);
  if (settled.length) formatNote += ` Goes out as: ${settled.map((s) => `${s.channel} → ${s.chose}`).join(", ")}.${fellBack.length ? ` ${fellBack.join(" ")}` : ""}`;
  const checked = await inspect(postId);
  const when = existing?.scheduledAt ?? (run.context.slot ? new Date(String(run.context.slot)) : null);
  return {
    outcome: "done",
    summary: `${existing ? "Revised" : "Wrote"} "${title}"${when ? ` for ${toLocalInput(when, brand.timezone).replace("T", " ")}` : ""}.${formatNote}`,
    subject: { type: "post", id: postId },
    context,
    output: { postId, title },
    usage,
    reasons: checked.reasons,
    review: checked.review,
    href: `/posts/${postId}`,
  };
}

/** Whether a post needs an image or video, and which platforms say so. */
async function mediaNeed(post: typeof posts.$inferSelect) {
  const idea = post.ideaId ? await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, post.ideaId) }) : null;
  const targets = await db.select({ platform: channels.platform }).from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(eq(postTargets.postId, post.id), ne(postTargets.status, "skipped")));
  const needy = [...new Set(targets.map((t) => platformOrNull(t.platform)).filter((p) => p?.constraints.requiresMedia))].map((p) => p!);
  return {
    idea, needy,
    needed: Boolean(idea?.needsMedia) || needy.length > 0,
    videoOnly: needy.some((p) => !p.constraints.allowedMedia.includes("image")),
  };
}

/**
 * Unsent channels that cannot go out yet because their platform wants an
 * image or video (or the idea only works with one) and the post has none.
 * Everything else about the post is ready, so these wait on their own and the
 * other channels carry on: one Instagram image must not hold up Bluesky.
 */
async function heldForMedia(post: typeof posts.$inferSelect) {
  const idea = post.ideaId ? await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, post.ideaId) }) : null;
  const [targets, files] = await Promise.all([
    db.select({ target: postTargets, platform: channels.platform, handle: channels.handle }).from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId)).where(eq(postTargets.postId, post.id)),
    db.select({ targetId: attachments.targetId }).from(attachments).where(eq(attachments.postId, post.id)),
  ]);
  const postLevel = files.some((a) => !a.targetId);
  return targets
    .filter(({ target, platform }) =>
      target.status === "pending"
      && (idea?.needsMedia || platformOrNull(platform)?.constraints.requiresMedia)
      && !postLevel && !files.some((a) => a.targetId === target.id))
    .map(({ target, platform }) => ({ id: target.id, channelId: target.channelId, name: platformOrNull(platform)?.name ?? platform }));
}

/**
 * Attaches the filed library image that best fits a post, by the post's own
 * words, format and shape — no model call. Images must be Canva designs: the
 * playbook's brand-visuals rule has every visual made in Canva from the brand
 * kit (Canva exports no video, so videos come from anywhere). Files already
 * turned down are skipped. null = nothing filed fits.
 */
async function attachBestMedia(post: typeof posts.$inferSelect, need: Awaited<ReturnType<typeof mediaNeed>>, tried: string[]) {
  const { library } = await searchBrandLibrary("", post.brandId, {});
  const idea = need.idea;
  const text = [post.title, post.body, post.campaign, idea && [idea.title, idea.pillar, idea.problem, idea.action, idea.outcome, ...idea.hashtags].filter(Boolean).join(" ")]
    .filter(Boolean).join("\n");
  const best = rankForText(library.filter((m) => (m.source === "canva" || m.kind === "video") && m.catalogedAt && !tried.includes(m.id)), text, {
    format: post.postType, kind: need.videoOnly ? "video" : undefined,
  })[0];
  if (!best) return null;
  await db.insert(attachments).values({ postId: post.id, mediaId: best.item.id, position: 0 });
  return {
    id: best.item.id, matched: best.matched, score: best.score,
    summary: `Attached "${truncate(best.item.altText || best.item.originalName, 60)}" — it matches ${best.matched.slice(0, 5).join(", ")}.`,
  };
}

async function media(ctx: StepContext): Promise<StepResult> {
  const { run } = ctx;
  const post = await loadPost(run);
  if (!post) return { outcome: "cancel", summary: "The post was deleted." };
  // Approved and booked on its own page: the approver judged it ready as it is.
  if (!["draft", "in_review", "changes_requested", "approved"].includes(post.status)) {
    return { outcome: "skip", summary: "Already scheduled by its approver." };
  }
  const need = await mediaNeed(post);
  if (!need.needed) return { outcome: "skip", summary: "This post needs no media." };

  const picked = typeof run.context.mediaPicked === "string" ? run.context.mediaPicked : null;
  const tried = Array.isArray(run.context.mediaTried) ? (run.context.mediaTried as string[]) : [];
  const attached = await db.select({ mediaId: attachments.mediaId }).from(attachments).where(eq(attachments.postId, post.id));

  if (ctx.feedback && picked) {
    // Sent back ("pick another"): take the agent's choice off before choosing again.
    await db.delete(attachments).where(and(eq(attachments.postId, post.id), eq(attachments.mediaId, picked)));
  } else if (attached.length) {
    // Already there — a person's file, or the one the writer picked and the post's approver saw.
    return { outcome: "done", summary: "Media is attached.", byHuman: true };
  }

  const best = await attachBestMedia(post, need, tried);
  if (!best && !need.idea?.needsMedia) {
    // Only some channels want media. The rest of the post must not wait for it.
    const held = await heldForMedia(post);
    const names = [...new Set(held.map((h) => h.name))];
    const others = (await db.select({ id: postTargets.id }).from(postTargets).where(eq(postTargets.postId, post.id))).length - held.length;
    return {
      outcome: "skip",
      summary: `${names.join(", ") || "A channel"} still needs an image or video, and none is filed or could be made. ${others > 0 ? "The other channels go out now; " : ""}${names.join(", ") || "it"} will wait for one.`,
    };
  }
  if (!best) {
    const why = need.needy.length
      ? `${need.needy.map((p) => p.name).join(", ")} need${need.needy.length === 1 ? "s" : ""} ${need.videoOnly ? "a video" : "an image or video"}`
      : "The idea calls for an image or video";
    return {
      outcome: "human",
      summary: `${why}, and no Canva design filed in the library fits${tried.length ? " that has not been turned down" : ""}.`,
      question: `Design an image for "${post.title || "this post"}" in Canva from the brand kit, import it into Media and file it, or attach one yourself.`,
      href: `/posts/${post.id}`,
      recheckAt: new Date(ctx.now.getTime() + 15 * MINUTE),
    };
  }
  return {
    outcome: "done", summary: best.summary,
    output: { mediaId: best.id, matched: best.matched, score: best.score },
    context: { mediaPicked: best.id, mediaTried: [...tried, best.id] },
    href: `/posts/${post.id}`,
  };
}

async function schedule(ctx: StepContext): Promise<StepResult> {
  const { run, brand, now } = ctx;
  const post = await loadPost(run);
  if (!post) return { outcome: "cancel", summary: "The post was deleted." };
  // Approved on its own page: nothing left to book.
  if (["scheduled", "publishing", "published", "partially_published"].includes(post.status)) {
    return { outcome: "done", summary: "Already scheduled.", byHuman: true };
  }

  // Media may have changed since the draft (a person attached a file): each channel re-picks its format.
  await settleFormats(post.id);
  // A channel waiting for its image has its own problems (a carousel with no slides yet); they must not hold the rest.
  const held = await heldForMedia(post);
  const heldChannels = new Set(held.map((h) => h.channelId));
  const blocked = blockingText(((await checkSavedPost(post.id)) ?? []).filter((c) => !heldChannels.has(c.channelId)));
  const targets = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
  const holes = findPlaceholders([post.title, post.body, ...targets.flatMap((t) => [t.bodyOverride ?? "", t.firstComment ?? ""])].join("\n"));
  const limits = await platformLimitProblems(post.id, held.map((h) => h.id));
  const reasons = [
    blocked,
    holes.length ? `Template placeholders are still unfilled: ${holes.join(", ")}.` : null,
    limits.length ? `Over a platform's limit: ${limits.join(" ")}` : null,
  ].filter((r): r is string => Boolean(r));
  // Approval came after the slot: book the next one instead of handing it back to a person.
  let slot = post.scheduledAt;
  let late: Date | null = null;
  if (!slot) reasons.push("The post has no date and time.");
  else if (slot.getTime() < now.getTime() - HOUR) {
    late = slot;
    slot = new Date(now.getTime() + 2 * MINUTE);
  }
  if (reasons.length) {
    return {
      outcome: "stop", summary: "Cannot be scheduled yet.", reasons,
      question: "Fix the post (or give it a new time), then retry — or send it back for the agent to fix.",
      href: `/posts/${post.id}`, sendBackTo: "draft",
    };
  }

  await db.update(posts).set({ status: "scheduled", approvedAt: now, scheduledAt: slot, updatedAt: now }).where(eq(posts.id, post.id));
  const heldIds = held.map((h) => h.id);
  await db.update(postTargets).set({ status: "scheduled", scheduledAt: slot })
    .where(and(eq(postTargets.postId, post.id), eq(postTargets.status, "pending"), heldIds.length ? notInArray(postTargets.id, heldIds) : undefined));
  if (late && heldIds.length) await db.update(postTargets).set({ scheduledAt: slot }).where(inArray(postTargets.id, heldIds));
  await snapPostTargets(post.id, now);
  // Whoever approved this step (a person, or the reviewer under auto-approve) approved these words.
  await stampApproval(post.id);
  await db.insert(activity).values({
    brandId: brand.id, actorId: null, action: "post.scheduled_by_workflow", entity: "post", entityId: post.id,
    meta: { workflowRun: run.id, note: "Passed every playbook must and the safety screen. The checklist points for people were covered by the workflow's review settings." },
  });
  const booked = (await db.query.posts.findFirst({ where: eq(posts.id, post.id) }))?.scheduledAt ?? slot!;
  const when = toLocalInput(booked, brand.timezone).replace("T", " ");
  return {
    outcome: "done",
    summary: [
      late ? `Its slot (${toLocalInput(late, brand.timezone).replace("T", " ")}) passed while it waited, so it moved to the next one.` : "",
      `Scheduled for ${when}.`,
      held.length ? `${[...new Set(held.map((h) => h.name))].join(", ")} wait${held.length === 1 ? "s" : ""} for an image or video; the rest go out.` : "",
    ].filter(Boolean).join(" "),
  };
}

async function publish(ctx: StepContext): Promise<StepResult> {
  const post = await loadPost(ctx.run);
  if (!post) return { outcome: "cancel", summary: "The post was deleted." };
  const targets = await db.select({ target: postTargets, platform: channels.platform }).from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, post.id));

  if (ctx.retry) {
    for (const { target } of targets) if (target.status === "failed") await publishTarget(target.id, { force: true });
    return publish({ ...ctx, retry: false });
  }

  // Channels that were waiting for an image go out as soon as it is attached.
  await settleFormats(post.id);
  const stillHeld = new Set((await heldForMedia(post)).map((h) => h.id));
  const releasable = targets.filter((t) => t.target.status === "pending" && !stillHeld.has(t.target.id));
  if (releasable.length) {
    for (const { target } of releasable) {
      const at = target.scheduledAt && target.scheduledAt.getTime() > ctx.now.getTime() ? target.scheduledAt : new Date(ctx.now.getTime() + MINUTE);
      await db.update(postTargets).set({ status: "scheduled", scheduledAt: at }).where(eq(postTargets.id, target.id));
    }
    await snapPostTargets(post.id, ctx.now);
    return publish(ctx);
  }

  const name = (p: string) => platformOrNull(p)?.name ?? p;
  const failed = targets.filter((t) => t.target.status === "failed");
  const manual = targets.filter((t) => t.target.status === "awaiting_manual");
  const pending = targets.filter((t) => ["scheduled", "publishing"].includes(t.target.status));
  const waitingForMedia = targets.filter((t) => t.target.status === "pending");

  if (pending.length) {
    const at = post.scheduledAt && post.scheduledAt > ctx.now ? post.scheduledAt : ctx.now;
    return { outcome: "wait", summary: `Waiting to go out on ${pending.map((t) => name(t.platform)).join(", ")}.`, until: new Date(at.getTime() + 10 * MINUTE) };
  }
  if (failed.length) {
    return {
      outcome: "stop", summary: `Failed on ${failed.map((t) => name(t.platform)).join(", ")}.`,
      reasons: failed.map((t) => `${name(t.platform)}: ${t.target.lastError ?? "failed"}`),
      question: "Fix the channel's connection, then retry — or stop here and post it by hand.",
      href: "/channels", sendBackTo: null,
    };
  }
  if (manual.length) {
    return {
      outcome: "human", summary: `${manual.map((t) => name(t.platform)).join(", ")} ${manual.length === 1 ? "has" : "have"} no publishing API, so a person posts it.`,
      question: `Post "${post.title || "this post"}" from the publish queue and tick it off.`,
      href: "/queue", recheckAt: new Date(ctx.now.getTime() + 30 * MINUTE),
    };
  }
  if (waitingForMedia.length) {
    const names = [...new Set(waitingForMedia.map((t) => name(t.platform)))];
    return {
      outcome: "human",
      summary: `${names.join(", ")} ${names.length === 1 ? "is" : "are"} waiting for an image or video; the other channels are done.`,
      question: `Add an image or video to "${post.title || "this post"}" for ${names.join(", ")}. It goes out by itself once it is attached.`,
      href: `/posts/${post.id}`,
      recheckAt: new Date(ctx.now.getTime() + 15 * MINUTE),
    };
  }
  const live = targets.filter((t) => t.target.status === "published").length;
  return { outcome: "done", summary: `Published on ${live} channel${live === 1 ? "" : "s"}.` };
}

/* --------------------------------------------------------------- hooks */

export const publishPost: WorkflowImpl = {
  handlers: { draft, media, schedule, publish },

  async onSendBack(run, userId, note) {
    if (run.subjectType !== "post" || !run.subjectId) return;
    // Only the writing step changes the copy; a sent-back image leaves the post as it is.
    if (run.stepIndex !== 0) return;
    await db.update(posts).set({ status: "changes_requested", updatedAt: new Date() }).where(eq(posts.id, run.subjectId));
    await db.insert(comments).values({ postId: run.subjectId, userId, body: note, kind: "changes_requested" });
  },

  async onReject(run, userId, note) {
    if (run.subjectType !== "post" || !run.subjectId) return;
    const post = await db.query.posts.findFirst({ where: eq(posts.id, run.subjectId), columns: { status: true, ideaId: true } });
    // Something already went out: leave the record of it alone.
    if (!post || ["published", "partially_published"].includes(post.status)) return;
    // Back to a plain draft with no slot, so the slot opens up again.
    await db.update(posts).set({ status: "draft", scheduledAt: null, approvedHash: null, ideaId: null, updatedAt: new Date() }).where(eq(posts.id, run.subjectId));
    // The idea is let go too, or it would sit linked to a dead draft and never be written again. It goes to the
    // back of the plan with the reason beside it, which the writer reads next time round.
    if (post.ideaId) {
      const idea = await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, post.ideaId) });
      if (idea) {
        const last = await db.select({ s: contentIdeas.sequence }).from(contentIdeas).where(eq(contentIdeas.ownerId, idea.ownerId)).orderBy(desc(contentIdeas.sequence)).limit(1);
        const stamp = new Date().toISOString().slice(0, 10);
        await db.update(contentIdeas).set({
          status: idea.status === "drafting" ? "backlog" : idea.status, plannedFor: null, sequence: (last[0]?.s ?? 0) + 1,
          notes: [idea.notes, `Written as a post on ${stamp} and turned down${note ? `: ${note}` : "."} Take a different angle.`].filter(Boolean).join("\n"),
          updatedAt: new Date(),
        }).where(eq(contentIdeas.id, idea.id));
      }
    }
    await db.update(postTargets).set({ status: "pending", scheduledAt: null })
      .where(and(eq(postTargets.postId, run.subjectId), inArray(postTargets.status, ["pending", "scheduled"])));
    await db.insert(comments).values({ postId: run.subjectId, userId, body: `Stopped in review${note ? `: ${note}` : "."}` });
  },
};
