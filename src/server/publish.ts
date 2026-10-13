import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { db, posts, postTargets, postVersions, channels, brands, activity, metrics } from "@/lib/db";
import { getPlatform, NotConnectedError, PlatformError, type MediaItem, type PublishContext } from "@/lib/platforms";
import { engagementRate, median } from "@/lib/performance";
import { observations } from "@/server/performance";
import { classifyFailure, retryDelayMs } from "@/lib/platforms/retry";
import { freshCredentials, isRevokedToken, markReconnect } from "@/server/channel-auth";
import { publicUrl } from "./media";
import { openPostEngagement } from "@/server/actions/engagement";
import { sendAlert } from "@/server/alerts";
import { slotFor } from "@/server/schedule";
import { publishBody } from "@/server/versions";
import { approvalHolds, returnToReview } from "@/server/approval";
import { attachmentRows, mediaForTarget, versionMediaItems } from "@/server/target-media";

const MAX_ATTEMPTS = 3;
/** A target claimed this long ago with no outcome was interrupted (crash, restart, timeout). */
const STALE_CLAIM_MS = 15 * 60 * 1000;

async function loadTargetContext(targetId: string) {
  const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
  if (!target) throw new Error("Target not found");
  const post = await db.query.posts.findFirst({ where: eq(posts.id, target.postId) });
  if (!post) throw new Error("Post not found");
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, target.channelId) });
  if (!channel) throw new Error("Channel not found");
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand) throw new Error("Brand not found");

  // Target-specific attachments win; a version's own media next; otherwise the post-level set applies.
  const version = target.versionId
    ? (await db.query.postVersions.findFirst({ where: eq(postVersions.id, target.versionId) })) ?? null
    : null;
  const items: MediaItem[] = mediaForTarget(await attachmentRows(post.id), target.id, version ? await versionMediaItems(version.mediaIds) : null);

  const ctx: PublishContext = {
    brand, channel, post, target,
    body: publishBody(target, version, post),
    firstComment: target.firstComment,
    media: items,
    options: (target.options ?? {}) as Record<string, unknown>,
    publicUrl: (m) => publicUrl(m.url),
    // A sign-in that can no longer be refreshed leaves no credentials, so the
    // adapter reports "not connected" and the post falls back to the queue.
    credentials: await freshCredentials(channel).catch(() => null),
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

  // What goes out must be what was approved. A forced send is an approver's own retry.
  if (!opts.force) {
    const held = await approvalHolds(ctx.post.id);
    if (!held.ok) {
      await returnToReview(ctx.post.id, held.reason);
      return { ok: false, targetId, error: held.reason, willRetry: false };
    }
  }

  if (ctx.channel.mode === "manual") {
    await db.update(postTargets).set({ status: "awaiting_manual" }).where(eq(postTargets.id, targetId));
    await rollupPostStatus(ctx.post.id);
    return { ok: true, targetId, status: "awaiting_manual", note: "Waiting for someone to post it." };
  }

  // Claim the target in one statement so two ticks (or a tick and a click) can
  // never both send it: only the caller whose UPDATE matches a row goes on.
  const claimed = await db
    .update(postTargets)
    .set({ status: "publishing", attempts: sql`${postTargets.attempts} + 1`, claimedAt: new Date() })
    .where(and(
      eq(postTargets.id, targetId),
      opts.force ? ne(postTargets.status, "publishing") : notInArray(postTargets.status, ["publishing", "published"]),
    ))
    .returning({ attempts: postTargets.attempts });
  if (claimed.length === 0) {
    return { ok: false, targetId, error: "Already being published, or already published.", willRetry: false };
  }
  const attempts = claimed[0].attempts;

  try {
    const result = await platform.publish(ctx);
    await db.update(postTargets).set({
      status: "published",
      publishedAt: new Date(),
      externalPostId: result.externalId ?? null,
      externalUrl: result.externalUrl ?? null,
      lastError: null,
      claimedAt: null,
    }).where(eq(postTargets.id, targetId));
    await db.insert(activity).values({
      brandId: ctx.brand.id, action: "target.published", entity: "post_target", entityId: targetId,
      meta: { platform: platform.id, url: result.externalUrl ?? null, ...(result.note ? { note: result.note } : {}) },
    });
    await rollupPostStatus(ctx.post.id);
    return { ok: true, targetId, status: "published", url: result.externalUrl, note: result.note };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing connection is a setup problem, not a transient failure: fall
    // back to the manual queue so the post still goes out today.
    // A token Meta has revoked is a setup problem too: the channel waits to be reconnected.
    if (isRevokedToken(err)) await markReconnect(ctx.channel, `${platform.name} no longer accepts the sign-in. Connect it again.`);
    const notConnected = err instanceof NotConnectedError || isRevokedToken(err);
    const failure = classifyFailure(err);
    // Only a failure that certainly did not post is tried again, and not straight away.
    const willRetry = !notConnected && failure.kind === "retry" && attempts < MAX_ATTEMPTS;
    const now = new Date();
    await db.update(postTargets).set({
      status: notConnected ? "awaiting_manual" : willRetry ? "scheduled" : "failed",
      lastError: !notConnected && failure.kind === "ambiguous"
        ? `${message} It may or may not have gone out: check ${platform.name} before posting it again.`
        : message,
      ...(willRetry ? { scheduledAt: new Date(now.getTime() + retryDelayMs(attempts, failure.retryAfterMs)) } : {}),
      claimedAt: null,
    }).where(eq(postTargets.id, targetId));
    await db.insert(activity).values({
      brandId: ctx.brand.id, action: "target.failed", entity: "post_target", entityId: targetId,
      meta: { platform: platform.id, error: message, attempts, kind: failure.kind },
    });
    await rollupPostStatus(ctx.post.id);
    if (!notConnected && !willRetry) {
      await sendAlert({
        brandId: ctx.brand.id, kind: "post_failed", key: targetId, path: `/posts/${ctx.post.id}`,
        subject: `A post to ${platform.name} failed`,
        lines: [
          failure.kind === "ambiguous"
            ? `A post to ${platform.name} (${ctx.channel.handle}) got no clear answer, so it was not sent again. It may already be live: check the channel, then retry it or mark it posted.`
            : failure.kind === "permanent"
              ? `${platform.name} (${ctx.channel.handle}) refused a post and trying again would not help.`
              : `A post to ${platform.name} (${ctx.channel.handle}) failed after ${attempts} attempts and will not be retried.`,
          `Error: ${message}`,
        ],
      });
    }
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

  // Anything live has comments coming, so open the engagement work now rather
  // than hoping someone remembers. Never let that be the reason a publish
  // reports failure — the post is already out.
  if (published > 0) {
    try {
      await openPostEngagement(postId);
    } catch (err) {
      console.error("Could not open engagement for post", postId, err);
    }
  }
}

/**
 * The scheduler tick. Picks up everything due and dispatches it.
 * Called by /api/cron/publish (Vercel Cron, or any external pinger).
 */
export async function runDuePublishes(limit = 25) {
  await failInterruptedPublishes();
  const due = await db
    .select()
    .from(postTargets)
    .where(and(inArray(postTargets.status, ["scheduled"]), lte(postTargets.scheduledAt, new Date())))
    .orderBy(asc(postTargets.scheduledAt))
    .limit(limit);

  const results: PublishOutcome[] = [];
  const now = new Date();
  for (const t of due) {
    try {
      // A channel posts only at its own times: a target that is due but off
      // its schedule is moved to the next slot and waits for it.
      // A retry already waited its backoff; the channel's slot times apply to the first send only.
      const slot = t.attempts > 0 ? null : await slotFor(t, now);
      if (slot && slot.getTime() > now.getTime()) {
        await db.update(postTargets).set({ scheduledAt: slot }).where(eq(postTargets.id, t.id));
        continue;
      }
      results.push(await publishTarget(t.id));
    } catch (err) {
      results.push({ ok: false, targetId: t.id, error: err instanceof Error ? err.message : String(err), willRetry: false });
    }
  }
  return results;
}

/**
 * When a published post's numbers are read: an hour, six hours, a day, two
 * days, three days, a week, two weeks and a month after it went out. A post
 * is read again once it has passed a checkpoint it has not been read since,
 * so it takes about eight readings in its life instead of one a day, and the
 * two-day reading, the one posts are judged on, is always taken.
 */
export const METRIC_CHECKPOINTS_H = [1, 6, 24, 48, 72, 168, 336, 720];
const HOUR_MS = 3_600_000;

export function metricsDue(publishedAt: Date, checkedAt: Date | null, now: Date) {
  const age = now.getTime() - publishedAt.getTime();
  const passed = METRIC_CHECKPOINTS_H.filter((h) => h * HOUR_MS <= age);
  if (passed.length === 0) return false;
  const last = Math.max(...passed) * HOUR_MS;
  return !checkedAt || checkedAt.getTime() < publishedAt.getTime() + last;
}

export type MetricsReport = {
  read: number; removed: number;
  failed: { channel: string; platform: string; error: string }[];
  anomalies: number;
};

/**
 * Reads the numbers of every published post that is due, across all brands (or
 * one), within a time budget. Runs on its own schedule, so the numbers keep
 * flowing whether or not the analyst agent is on. A post the platform says is
 * gone stops counting; a channel that cannot be read is reported, not hidden.
 */
export async function refreshDueMetrics(now = new Date(), opts: { brandId?: string; budgetMs?: number; limit?: number } = {}): Promise<MetricsReport> {
  const started = Date.now();
  const report: MetricsReport = { read: 0, removed: 0, failed: [], anomalies: 0 };
  const rows = await db
    .select({ target: postTargets, channel: channels, post: posts })
    .from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(
      eq(postTargets.status, "published"), isNull(postTargets.removedAt), isNotNull(postTargets.externalPostId),
      gte(postTargets.publishedAt, new Date(now.getTime() - 31 * 24 * HOUR_MS)),
      opts.brandId ? eq(posts.brandId, opts.brandId) : undefined,
    ));

  const due = rows
    .filter((r) => r.target.publishedAt && r.channel.mode === "live" && metricsDue(r.target.publishedAt, r.target.metricsCheckedAt, now))
    .sort((a, b) => a.target.publishedAt!.getTime() - b.target.publishedAt!.getTime())
    .slice(0, opts.limit ?? 80);

  const baselines = new Map<string, Map<string, number> | null>();
  const failedChannels = new Set<string>();
  const flaggedBy = new Map<string, number>();
  for (const { target, channel, post } of due) {
    if (Date.now() - started > (opts.budgetMs ?? 45_000)) break;
    const platform = getPlatform(channel.platform);
    if (!platform.fetchMetrics) {
      // Nothing to read here, ever: do not come back for it at every checkpoint.
      await db.update(postTargets).set({ metricsCheckedAt: now }).where(eq(postTargets.id, target.id));
      continue;
    }
    try {
      const m = await platform.fetchMetrics({
        channel, externalPostId: target.externalPostId!, credentials: await freshCredentials(channel),
      });
      const [reading] = await db.insert(metrics).values({
        targetId: target.id,
        impressions: m.impressions ?? 0, reach: m.reach ?? 0, likes: m.likes ?? 0,
        commentCount: m.commentCount ?? 0, shares: m.shares ?? 0, saves: m.saves ?? 0,
        clicks: m.clicks ?? 0, videoViews: m.videoViews ?? 0, raw: m.raw ?? {}, fetchedAt: now,
      }).returning();
      const previous = target.metricsCheckedAt;
      await db.update(postTargets).set({ metricsCheckedAt: now }).where(eq(postTargets.id, target.id));
      report.read++;

      // The first reading after a day is the moment to notice a post running far ahead of, or behind, its usual.
      const dayMark = target.publishedAt!.getTime() + 24 * HOUR_MS;
      // Only a post still fresh, and a couple per brand each time: the first catch-up read of old posts is not news.
      const fresh = now.getTime() - target.publishedAt!.getTime() < 72 * HOUR_MS;
      const flagged = flaggedBy.get(post.brandId) ?? 0;
      if (fresh && flagged < 2 && now.getTime() >= dayMark && (!previous || previous.getTime() < dayMark)) {
        if (await flagAnomaly({ post, channel, target, reading, baselines, now })) {
          report.anomalies++;
          flaggedBy.set(post.brandId, flagged + 1);
        }
      }
    } catch (err) {
      if (err instanceof PlatformError && (err.status === 404 || err.status === 410)) {
        await db.update(postTargets).set({ removedAt: now, metricsCheckedAt: now }).where(eq(postTargets.id, target.id));
        await db.insert(activity).values({
          brandId: post.brandId, action: "target.removed_on_platform", entity: "post_target", entityId: target.id,
          meta: { platform: channel.platform },
        });
        report.removed++;
      } else if (!failedChannels.has(channel.id)) {
        failedChannels.add(channel.id);
        report.failed.push({ channel: channel.handle, platform: channel.platform, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      }
    }
  }
  return report;
}

/** Same as above for one brand, for callers that want it fresh now (the analyst). Returns how many readings it took. */
export async function refreshMetrics(brandId: string, now = new Date()) {
  return refreshDueMetrics(now, { brandId, budgetMs: 30_000 });
}

/** Alerts the brand's owners when a post is far from the usual on its platform. */
async function flagAnomaly(args: {
  post: typeof posts.$inferSelect; channel: typeof channels.$inferSelect; target: typeof postTargets.$inferSelect;
  reading: typeof metrics.$inferSelect; baselines: Map<string, Map<string, number> | null>; now: Date;
}) {
  const { post, channel, target, reading, baselines, now } = args;
  const rate = engagementRate(reading);
  if (rate === null) return false;
  if (!baselines.has(post.brandId)) {
    const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId), columns: { timezone: true } });
    const obs = await observations(post.brandId, 90, now, brand?.timezone ?? "UTC");
    const byPlatform = new Map<string, number[]>();
    for (const o of obs) (byPlatform.get(o.platform) ?? byPlatform.set(o.platform, []).get(o.platform)!).push(o.rate);
    baselines.set(post.brandId, new Map([...byPlatform].filter(([, rs]) => rs.length >= 8).map(([p, rs]) => [p, median(rs)])));
  }
  const usual = baselines.get(post.brandId)?.get(channel.platform);
  if (!usual || usual <= 0) return false;
  const ratio = rate / usual;
  if (ratio < 3 && ratio > 0.2) return false;
  const name = getPlatform(channel.platform).name;
  const ahead = ratio >= 3;
  const res = await sendAlert({
    brandId: post.brandId, kind: "post_anomaly", key: target.id, path: `/posts/${post.id}`,
    subject: ahead ? `"${post.title || "A post"}" is taking off on ${name}` : `"${post.title || "A post"}" is falling flat on ${name}`,
    lines: [
      `A day in, this post on ${name} (${channel.handle}) has ${(rate * 100).toFixed(1)}% engagement, ${ratio >= 1 ? `${ratio.toFixed(1)}× the` : `${ratio.toFixed(2)}× the`} usual ${(usual * 100).toFixed(1)}% there.`,
      ahead ? "Worth replying to the comments quickly and making more like it." : "Worth looking at when it went out, and what it said.",
    ],
  });
  return res === "sent";
}

/**
 * A target left in `publishing` past the stale window was cut off mid-send, so
 * the platform may or may not have it. Retrying blind could post twice, so it
 * is marked failed with a note and a person decides.
 */
export async function failInterruptedPublishes() {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const stuck = await db
    .update(postTargets)
    .set({ status: "failed", claimedAt: null, lastError: "Interrupted while publishing. Check the channel for the post before retrying." })
    .where(and(eq(postTargets.status, "publishing"), lt(postTargets.claimedAt, cutoff)))
    .returning({ id: postTargets.id, postId: postTargets.postId });
  for (const t of stuck) {
    await rollupPostStatus(t.postId);
    const post = await db.query.posts.findFirst({ where: eq(posts.id, t.postId), columns: { brandId: true } });
    if (post) {
      await sendAlert({
        brandId: post.brandId, kind: "post_interrupted", key: t.id, path: `/posts/${t.postId}`,
        subject: "A post was cut off while publishing",
        lines: ["A post was interrupted while it was being sent. It may or may not be live on the platform.", "Check the channel before retrying, or it could go out twice."],
      });
    }
  }
  return stuck.length;
}
