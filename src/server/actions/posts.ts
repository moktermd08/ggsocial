"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  db, posts, postTargets, channels, attachments, comments, activity, media,
  type PostStatus,
} from "@/lib/db";
import { requireBrandRole, requireUser, can } from "@/lib/auth";
import { defaultOptions, getPlatform, validateTarget, type MediaItem } from "@/lib/platforms";
import { publishTarget, markTargetPosted, rollupPostStatus } from "@/server/publish";
import { syncCopy } from "@/server/masters";
import { findPlaceholders } from "@/lib/templates";

export type TargetInput = {
  channelId: string;
  bodyOverride?: string | null;
  firstComment?: string | null;
  options?: Record<string, unknown>;
};

export type PostInput = {
  brandId: string;
  postId?: string;
  title: string;
  body: string;
  scheduledAt?: string | null;
  campaign?: string | null;
  tags?: string[];
  /** Set when the post was started from a template. */
  postType?: string | null;
  mediaIds: string[];
  targets: TargetInput[];
  /** What the save button was: keeps drafts out of the queue. */
  intent: "draft" | "review" | "schedule" | "publish_now";
};

async function loadMedia(ids: string[]): Promise<MediaItem[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(media).where(inArray(media.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((m): m is MediaItem => Boolean(m));
}

/** Runs every target through its platform's rules. Errors block scheduling. */
export async function validatePostAction(input: PostInput) {
  const items = await loadMedia(input.mediaIds);
  const chans = input.targets.length
    ? await db.select().from(channels).where(inArray(channels.id, input.targets.map((t) => t.channelId)))
    : [];
  const byId = new Map(chans.map((c) => [c.id, c]));

  return input.targets.map((t) => {
    const channel = byId.get(t.channelId);
    if (!channel) return { channelId: t.channelId, issues: [{ level: "error" as const, message: "Channel not found." }] };
    return {
      channelId: t.channelId,
      issues: validateTarget({
        platformId: channel.platform,
        body: t.bodyOverride ?? input.body,
        media: items,
        options: t.options ?? {},
      }),
    };
  });
}

export async function savePostAction(input: PostInput) {
  const { user, role } = await requireBrandRole(input.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to save posts.");

  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

  if (input.intent === "schedule" || input.intent === "publish_now") {
    const validation = await validatePostAction(input);
    const blocking = validation.flatMap((v) => v.issues.filter((i) => i.level === "error"));
    if (blocking.length) throw new Error(blocking.map((b) => b.message).join(" "));
    if (input.targets.length === 0) throw new Error("Pick at least one channel.");
    if (input.intent === "schedule" && !scheduledAt) throw new Error("Choose a date and time.");
    const holes = findPlaceholders([
      input.title, input.body, ...input.targets.flatMap((t) => [t.bodyOverride ?? "", t.firstComment ?? ""]),
    ].join("\n"));
    if (holes.length) throw new Error(`Fill in the template placeholders first: ${holes.join(", ")}.`);
  }

  const status: PostStatus =
    input.intent === "draft" ? "draft"
    : input.intent === "review" ? "in_review"
    : "scheduled";

  let postId = input.postId;
  if (postId) {
    await requireBrandRole(input.brandId, "editor");
    await db.update(posts).set({
      title: input.title, body: input.body, scheduledAt, campaign: input.campaign ?? null,
      tags: input.tags ?? [], status, updatedAt: new Date(),
      ...(input.postType !== undefined ? { postType: input.postType } : {}),
    }).where(eq(posts.id, postId));
  } else {
    const [created] = await db.insert(posts).values({
      brandId: input.brandId, title: input.title, body: input.body, scheduledAt,
      campaign: input.campaign ?? null, tags: input.tags ?? [], status, createdBy: user.id, postType: input.postType ?? null,
    }).returning();
    postId = created.id;
  }

  // Replace the target set: simpler than diffing, and keeps ids stable via upsert.
  const existing = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
  const keep = new Set(input.targets.map((t) => t.channelId));
  const toDelete = existing.filter((e) => !keep.has(e.channelId) && e.status !== "published");
  if (toDelete.length) {
    await db.delete(postTargets).where(inArray(postTargets.id, toDelete.map((t) => t.id)));
  }

  for (const t of input.targets) {
    const prior = existing.find((e) => e.channelId === t.channelId);
    const channel = await db.query.channels.findFirst({ where: eq(channels.id, t.channelId) });
    if (!channel || channel.brandId !== input.brandId) throw new Error("That channel is not on this brand.");
    // Platform defaults, then this channel's saved defaults, then whatever the
    // writer typed for this post. Last one wins.
    const channelDefaults = (channel.settings ?? {}) as Record<string, unknown>;
    const options = { ...defaultOptions(channel.platform), ...channelDefaults, ...(t.options ?? {}) };
    const targetStatus = input.intent === "schedule" || input.intent === "publish_now" ? "scheduled" : "pending";

    if (prior) {
      if (prior.status === "published") continue;
      await db.update(postTargets).set({
        bodyOverride: t.bodyOverride ?? null, firstComment: t.firstComment ?? null,
        options, status: targetStatus, scheduledAt: input.intent === "publish_now" ? new Date() : scheduledAt,
      }).where(eq(postTargets.id, prior.id));
    } else {
      await db.insert(postTargets).values({
        postId, channelId: t.channelId, bodyOverride: t.bodyOverride ?? null,
        firstComment: t.firstComment ?? null, options, status: targetStatus,
        scheduledAt: input.intent === "publish_now" ? new Date() : scheduledAt,
      });
    }
  }

  // Post-level attachments (target overrides are edited separately).
  await db.delete(attachments).where(and(eq(attachments.postId, postId)));
  for (const [i, mediaId] of input.mediaIds.entries()) {
    await db.insert(attachments).values({ postId, mediaId, position: i });
  }

  // A brand copy: whatever now matches the master is back in step with it,
  // and master changes to fields this save left alone come through.
  await syncCopy(postId);

  await db.insert(activity).values({
    brandId: input.brandId, actorId: user.id, action: `post.${input.intent}`, entity: "post", entityId: postId,
  });

  if (input.intent === "publish_now") {
    const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
    for (const t of targets) if (t.status !== "published") await publishTarget(t.id);
  }

  revalidatePath("/", "layout");
  return { postId };
}

export async function deletePostAction(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return;
  await requireBrandRole(post.brandId, "editor");
  await db.delete(posts).where(eq(posts.id, postId));
  revalidatePath("/", "layout");
  redirect("/posts");
}

export async function duplicatePostAction(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) throw new Error("Post not found");
  const { user } = await requireBrandRole(post.brandId, "editor");

  const [copy] = await db.insert(posts).values({
    brandId: post.brandId, title: `${post.title} (copy)`, body: post.body,
    campaign: post.campaign, tags: post.tags, status: "draft", createdBy: user.id,
  }).returning();

  const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
  for (const t of targets) {
    await db.insert(postTargets).values({
      postId: copy.id, channelId: t.channelId, bodyOverride: t.bodyOverride,
      firstComment: t.firstComment, options: t.options, status: "pending",
    });
  }
  const atts = await db.select().from(attachments).where(eq(attachments.postId, postId));
  for (const a of atts.filter((a) => a.targetId === null)) {
    await db.insert(attachments).values({ postId: copy.id, mediaId: a.mediaId, position: a.position });
  }
  redirect(`/posts/${copy.id}`);
}

/** Drag-and-drop on the calendar. */
export async function reschedulePostAction(postId: string, iso: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) throw new Error("Post not found");
  await requireBrandRole(post.brandId, "editor");
  const when = new Date(iso);
  await db.update(posts).set({ scheduledAt: when, updatedAt: new Date() }).where(eq(posts.id, postId));
  await db.update(postTargets).set({ scheduledAt: when })
    .where(and(eq(postTargets.postId, postId), inArray(postTargets.status, ["pending", "scheduled", "failed"])));
  revalidatePath("/", "layout");
}

/**
 * What the review panel's actions return. Expected failures (a placeholder
 * left in, no permission) come back as values, because a thrown message is
 * replaced by a generic one in production builds and the reviewer would never
 * learn what to fix.
 */
export type ReviewResult = { ok: true } | { ok: false; error: string };

async function asResult(work: () => Promise<unknown>): Promise<ReviewResult> {
  try {
    await work();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export async function submitForReviewAction(postId: string): Promise<ReviewResult> {
  return asResult(async () => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new Error("Post not found");
    const { user } = await requireBrandRole(post.brandId, "editor");
    await db.update(posts).set({ status: "in_review", updatedAt: new Date() }).where(eq(posts.id, postId));
    await db.insert(activity).values({ brandId: post.brandId, actorId: user.id, action: "post.submitted", entity: "post", entityId: postId });
    revalidatePath("/", "layout");
  });
}

export async function reviewPostAction(postId: string, decision: "approve" | "request_changes", note: string): Promise<ReviewResult> {
  return asResult(async () => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new Error("Post not found");
    const { user, role } = await requireBrandRole(post.brandId, "viewer");
    if (!can.approve(role)) throw new Error("You need approver or admin access to review posts.");

    if (decision === "approve") {
      const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
      const holes = findPlaceholders([
        post.title, post.body, ...targets.flatMap((t) => [t.bodyOverride ?? "", t.firstComment ?? ""]),
      ].join("\n"));
      if (holes.length) throw new Error(`This post still has template placeholders to fill: ${holes.join(", ")}.`);
      await db.update(posts).set({
        status: post.scheduledAt ? "scheduled" : "approved",
        approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date(),
      }).where(eq(posts.id, postId));
      if (post.scheduledAt) {
        await db.update(postTargets).set({ status: "scheduled", scheduledAt: post.scheduledAt })
          .where(and(eq(postTargets.postId, postId), eq(postTargets.status, "pending")));
      }
    } else {
      await db.update(posts).set({ status: "changes_requested", updatedAt: new Date() }).where(eq(posts.id, postId));
    }

    if (note.trim()) {
      await db.insert(comments).values({
        postId, userId: user.id, body: note.trim(),
        kind: decision === "approve" ? "approved" : "changes_requested",
      });
    }
    await db.insert(activity).values({ brandId: post.brandId, actorId: user.id, action: `post.${decision}`, entity: "post", entityId: postId });
    revalidatePath("/", "layout");
  });
}

export async function addCommentAction(postId: string, body: string): Promise<ReviewResult> {
  return asResult(async () => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) throw new Error("Post not found");
    const { user } = await requireBrandRole(post.brandId, "viewer");
    if (!body.trim()) return;
    await db.insert(comments).values({ postId, userId: user.id, body: body.trim() });
    revalidatePath(`/posts/${postId}`);
  });
}

export async function publishTargetNowAction(targetId: string) {
  const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
  if (!target) throw new Error("Target not found");
  const post = await db.query.posts.findFirst({ where: eq(posts.id, target.postId) });
  if (!post) throw new Error("Post not found");
  await requireBrandRole(post.brandId, "editor");
  const result = await publishTarget(targetId, { force: false });
  revalidatePath("/", "layout");
  return result;
}

export async function markPostedAction(targetId: string, url?: string) {
  const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
  if (!target) throw new Error("Target not found");
  const post = await db.query.posts.findFirst({ where: eq(posts.id, target.postId) });
  if (!post) throw new Error("Post not found");
  const { user } = await requireBrandRole(post.brandId, "editor");
  await markTargetPosted(targetId, url);
  await db.insert(activity).values({
    brandId: post.brandId, actorId: user.id, action: "target.marked_posted", entity: "post_target", entityId: targetId,
  });
  revalidatePath("/", "layout");
}

export async function skipTargetAction(targetId: string) {
  const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
  if (!target) throw new Error("Target not found");
  const post = await db.query.posts.findFirst({ where: eq(posts.id, target.postId) });
  if (!post) throw new Error("Post not found");
  await requireBrandRole(post.brandId, "editor");
  await db.update(postTargets).set({ status: "skipped" }).where(eq(postTargets.id, targetId));
  await rollupPostStatus(target.postId);
  revalidatePath("/", "layout");
}

/** Copy tuned for one platform, reused as the starting point for another. */
export async function copyFromPlatformAction(platformId: string, body: string) {
  await requireUser();
  const p = getPlatform(platformId);
  return body.slice(0, p.constraints.textMax);
}
