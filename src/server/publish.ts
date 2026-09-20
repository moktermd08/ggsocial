import "server-only";
import { and, eq, inArray, lte, asc } from "drizzle-orm";
import { db, posts, postTargets, channels, brands, media, attachments, activity, metrics } from "@/lib/db";
import { getPlatform, NotConnectedError, type MediaItem, type PublishContext } from "@/lib/platforms";
import { decryptJson } from "@/lib/crypto";
import { publicUrl } from "./media";

const MAX_ATTEMPTS = 3;

async function loadTargetContext(targetId: string) {
  const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
  if (!target) throw new Error("Target not found");
  const post = await db.query.posts.findFirst({ where: eq(posts.id, target.postId) });
  if (!post) throw new Error("Post not found");
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, target.channelId) });
  if (!channel) throw new Error("Channel not found");
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand) throw new Error("Brand not found");

  // Target-specific attachments win; otherwise the post-level set applies.
  const rows = await db
    .select({ attachment: attachments, item: media })
    .from(attachments)
    .innerJoin(media, eq(media.id, attachments.mediaId))
    .where(eq(attachments.postId, post.id))
    .orderBy(asc(attachments.position));
  const forTarget = rows.filter((r) => r.attachment.targetId === target.id);
  const items: MediaItem[] = (forTarget.length ? forTarget : rows.filter((r) => r.attachment.targetId === null)).map((r) => r.item);

  const ctx: PublishContext = {
    brand, channel, post, target,
    body: target.bodyOverride ?? post.body,
    firstComment: target.firstComment,
    media: items,
    options: (target.options ?? {}) as Record<string, unknown>,
    publicUrl: (m) => publicUrl(m.url),
    credentials: decryptJson<Record<string, string>>(channel.credentials),
  };
  return ctx;
}

export type PublishOutcome =
  | { ok: true; targetId: string; status: "published" | "awaiting_manual"; url?: string; note?: string }
  | { ok: false; targetId: string; error: string; willRetry: boolean };

/**
 * Publishes one channel's copy of a post.
 * Manual channels stop at "awaiting_manual" — the publish queue then shows
 * the prepared copy and media for a person to post and tick off.
 */
export async function publishTarget(targetId: string, opts: { force?: boolean } = {}): Promise<PublishOutcome> {
  const ctx = await loadTargetContext(targetId);
  const platform = getPlatform(ctx.channel.platform);

  if (ctx.target.status === "published" && !opts.force) {
    return { ok: true, targetId, status: "published", url: ctx.target.externalUrl ?? undefined };
  }

  if (ctx.channel.mode === "manual") {
    await db.update(postTargets).set({ status: "awaiting_manual" }).where(eq(postTargets.id, targetId));
    await rollupPostStatus(ctx.post.id);
    return { ok: true, targetId, status: "awaiting_manual", note: "Waiting for someone to post it." };
  }

  await db.update(postTargets).set({ status: "publishing", attempts: ctx.target.attempts + 1 }).where(eq(postTargets.id, targetId));

  try {
    const result = await platform.publish(ctx);
    await db.update(postTargets).set({
      status: "published",
      publishedAt: new Date(),
      externalPostId: result.externalId ?? null,
      externalUrl: result.externalUrl ?? null,
      lastError: null,
    }).where(eq(postTargets.id, targetId));
    await db.insert(activity).values({
      brandId: ctx.brand.id, action: "target.published", entity: "post_target", entityId: targetId,
      meta: { platform: platform.id, url: result.externalUrl ?? null },
    });
    await rollupPostStatus(ctx.post.id);
    return { ok: true, targetId, status: "published", url: result.externalUrl, note: result.note };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing connection is a setup problem, not a transient failure: fall
    // back to the manual queue so the post still goes out today.
    const notConnected = err instanceof NotConnectedError;
    const attempts = ctx.target.attempts + 1;
    const willRetry = !notConnected && attempts < MAX_ATTEMPTS;
    await db.update(postTargets).set({
      status: notConnected ? "awaiting_manual" : willRetry ? "scheduled" : "failed",
      lastError: message,
    }).where(eq(postTargets.id, targetId));
    await db.insert(activity).values({
      brandId: ctx.brand.id, action: "target.failed", entity: "post_target", entityId: targetId,
      meta: { platform: platform.id, error: message, attempts },
    });
    await rollupPostStatus(ctx.post.id);
    return { ok: false, targetId, error: message, willRetry };
  }
}

/** Marks a manual target as done once a human has actually posted it. */
export async function markTargetPosted(targetId: string, externalUrl?: string) {
  const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
  if (!target) throw new Error("Target not found");
  await db.update(postTargets).set({
    status: "published",
    publishedAt: new Date(),
    externalUrl: externalUrl?.trim() || null,
    lastError: null,
  }).where(eq(postTargets.id, targetId));
  await rollupPostStatus(target.postId);
}

/** Derives the post's status from its targets. */
export async function rollupPostStatus(postId: string) {
  const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
  if (targets.length === 0) return;
  const statuses = targets.map((t) => t.status);
  const published = statuses.filter((s) => s === "published").length;
  const failed = statuses.filter((s) => s === "failed").length;
  const outstanding = statuses.filter((s) => ["pending", "scheduled", "publishing", "awaiting_manual"].includes(s)).length;

  let status: typeof posts.$inferSelect.status;
  if (published === statuses.length) status = "published";
  else if (published > 0 && outstanding === 0) status = "partially_published";
  else if (published > 0) status = "partially_published";
  else if (failed > 0 && outstanding === 0) status = "failed";
  else status = "scheduled";

  await db.update(posts).set({
    status,
    publishedAt: published > 0 ? (targets.find((t) => t.publishedAt)?.publishedAt ?? new Date()) : null,
    updatedAt: new Date(),
  }).where(eq(posts.id, postId));
}

/**
 * The scheduler tick. Picks up everything due and dispatches it.
 * Called by /api/cron/publish (Vercel Cron, or any external pinger).
 */
export async function runDuePublishes(limit = 25) {
  const due = await db
    .select()
    .from(postTargets)
    .where(and(inArray(postTargets.status, ["scheduled"]), lte(postTargets.scheduledAt, new Date())))
    .orderBy(asc(postTargets.scheduledAt))
    .limit(limit);

  const results: PublishOutcome[] = [];
  for (const t of due) {
    try {
      results.push(await publishTarget(t.id));
    } catch (err) {
      results.push({ ok: false, targetId: t.id, error: err instanceof Error ? err.message : String(err), willRetry: false });
    }
  }
  return results;
}

/** Pulls fresh engagement numbers for published targets that support it. */
export async function refreshMetrics(brandId: string, sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const rows = await db
    .select({ target: postTargets, channel: channels })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(posts.brandId, brandId), eq(postTargets.status, "published")));

  let updated = 0;
  for (const { target, channel } of rows) {
    if (!target.externalPostId || !target.publishedAt || target.publishedAt < since) continue;
    const platform = getPlatform(channel.platform);
    if (!platform.fetchMetrics || channel.mode !== "live") continue;
    try {
      const m = await platform.fetchMetrics({
        channel,
        externalPostId: target.externalPostId,
        credentials: decryptJson<Record<string, string>>(channel.credentials),
      });
      await db.insert(metrics).values({
        targetId: target.id,
        impressions: m.impressions ?? 0, reach: m.reach ?? 0, likes: m.likes ?? 0,
        commentCount: m.commentCount ?? 0, shares: m.shares ?? 0, saves: m.saves ?? 0,
        clicks: m.clicks ?? 0, videoViews: m.videoViews ?? 0, raw: m.raw ?? {},
      });
      updated++;
    } catch {
      // Metrics are best-effort; a failure here must not break the page.
    }
  }
  return updated;
}
