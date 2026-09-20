import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db, posts, postTargets, channels, brands, media, attachments, comments, users, memberships, metrics,
} from "@/lib/db";
import type { PostStatus } from "@/lib/db";

export type ChannelRow = typeof channels.$inferSelect;
export type PostRow = typeof posts.$inferSelect;

/** A post with everything the calendar, list and composer need to render it. */
export type PostBundle = PostRow & {
  brand: typeof brands.$inferSelect;
  targets: (typeof postTargets.$inferSelect & { channel: ChannelRow })[];
  media: (typeof media.$inferSelect)[];
};

export async function getBrandChannels(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  return db.select().from(channels)
    .where(and(inArray(channels.brandId, brandIds), isNull(channels.archivedAt)))
    .orderBy(asc(channels.platform), asc(channels.handle));
}

async function hydrate(rows: PostRow[], brandIds: string[]): Promise<PostBundle[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [targetRows, attachmentRows, brandRows] = await Promise.all([
    db.select({ target: postTargets, channel: channels })
      .from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(inArray(postTargets.postId, ids)),
    db.select({ attachment: attachments, item: media })
      .from(attachments)
      .innerJoin(media, eq(media.id, attachments.mediaId))
      .where(inArray(attachments.postId, ids))
      .orderBy(asc(attachments.position)),
    db.select().from(brands).where(inArray(brands.id, brandIds.length ? brandIds : ["-"])),
  ]);

  const brandById = new Map(brandRows.map((b) => [b.id, b]));
  return rows.map((post) => ({
    ...post,
    brand: brandById.get(post.brandId)!,
    targets: targetRows.filter((t) => t.target.postId === post.id).map((t) => ({ ...t.target, channel: t.channel })),
    media: attachmentRows.filter((a) => a.attachment.postId === post.id && a.attachment.targetId === null).map((a) => a.item),
  }));
}

export async function getPosts(opts: {
  brandIds: string[];
  from?: Date;
  to?: Date;
  statuses?: PostStatus[];
  platform?: string;
  search?: string;
  limit?: number;
}): Promise<PostBundle[]> {
  if (opts.brandIds.length === 0) return [];
  const where = [inArray(posts.brandId, opts.brandIds)];
  if (opts.from) where.push(or(gte(posts.scheduledAt, opts.from), isNull(posts.scheduledAt))!);
  if (opts.to) where.push(or(lte(posts.scheduledAt, opts.to), isNull(posts.scheduledAt))!);
  if (opts.statuses?.length) where.push(inArray(posts.status, opts.statuses));
  if (opts.search) where.push(sql`(${posts.title} ILIKE ${"%" + opts.search + "%"} OR ${posts.body} ILIKE ${"%" + opts.search + "%"})`);

  const rows = await db.select().from(posts).where(and(...where))
    .orderBy(desc(sql`coalesce(${posts.scheduledAt}, ${posts.updatedAt})`))
    .limit(opts.limit ?? 200);

  const hydrated = await hydrate(rows, opts.brandIds);
  return opts.platform ? hydrated.filter((p) => p.targets.some((t) => t.channel.platform === opts.platform)) : hydrated;
}

/** Posts that land inside a date window — used by the calendar. */
export async function getCalendarPosts(brandIds: string[], from: Date, to: Date): Promise<PostBundle[]> {
  if (brandIds.length === 0) return [];
  const rows = await db.select().from(posts)
    .where(and(inArray(posts.brandId, brandIds), gte(posts.scheduledAt, from), lte(posts.scheduledAt, to)))
    .orderBy(asc(posts.scheduledAt));
  return hydrate(rows, brandIds);
}

export async function getPost(postId: string): Promise<(PostBundle & {
  comments: (typeof comments.$inferSelect & { user: { name: string } | null })[];
  targetMedia: Record<string, (typeof media.$inferSelect)[]>;
}) | null> {
  const row = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!row) return null;
  const [bundle] = await hydrate([row], [row.brandId]);
  const commentRows = await db.select({ comment: comments, user: { name: users.name } })
    .from(comments).leftJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.postId, postId)).orderBy(asc(comments.createdAt));
  const perTarget = await db.select({ attachment: attachments, item: media })
    .from(attachments).innerJoin(media, eq(media.id, attachments.mediaId))
    .where(and(eq(attachments.postId, postId), sql`${attachments.targetId} is not null`));
  const targetMedia: Record<string, (typeof media.$inferSelect)[]> = {};
  for (const r of perTarget) {
    const key = r.attachment.targetId!;
    (targetMedia[key] ??= []).push(r.item);
  }
  return { ...bundle, comments: commentRows.map((c) => ({ ...c.comment, user: c.user })), targetMedia };
}

/** Everything a person has to act on right now, across all their brands. */
export async function getDashboard(brandIds: string[]) {
  if (brandIds.length === 0) {
    return { counts: {} as Record<PostStatus, number>, needsApproval: [], upcoming: [], failures: [], manualQueue: [], recent: [] };
  }
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 86400_000);

  const [countRows, needsApproval, upcoming, failing, manual, recent] = await Promise.all([
    db.select({ status: posts.status, n: sql<number>`count(*)::int` })
      .from(posts).where(inArray(posts.brandId, brandIds)).groupBy(posts.status),
    db.select().from(posts)
      .where(and(inArray(posts.brandId, brandIds), eq(posts.status, "in_review")))
      .orderBy(asc(posts.scheduledAt)).limit(10),
    db.select().from(posts)
      .where(and(inArray(posts.brandId, brandIds), inArray(posts.status, ["scheduled", "approved"]),
        gte(posts.scheduledAt, now), lte(posts.scheduledAt, weekOut)))
      .orderBy(asc(posts.scheduledAt)).limit(15),
    db.select({ target: postTargets, post: posts, channel: channels })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(inArray(posts.brandId, brandIds), eq(postTargets.status, "failed")))
      .limit(20),
    db.select({ target: postTargets, post: posts, channel: channels })
      .from(postTargets)
      .innerJoin(posts, eq(posts.id, postTargets.postId))
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(inArray(posts.brandId, brandIds), eq(postTargets.status, "awaiting_manual")))
      .orderBy(asc(postTargets.scheduledAt)).limit(30),
    db.select().from(posts)
      .where(and(inArray(posts.brandId, brandIds), eq(posts.status, "published")))
      .orderBy(desc(posts.publishedAt)).limit(8),
  ]);

  const counts = Object.fromEntries(countRows.map((r) => [r.status, r.n])) as Record<PostStatus, number>;
  return {
    counts,
    needsApproval: await hydrate(needsApproval, brandIds),
    upcoming: await hydrate(upcoming, brandIds),
    failures: failing,
    manualQueue: manual,
    recent: await hydrate(recent, brandIds),
  };
}

/** The manual publish queue: prepared posts waiting for a human. */
export async function getPublishQueue(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  const rows = await db.select({ target: postTargets, post: posts, channel: channels, brand: brands })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(inArray(posts.brandId, brandIds), inArray(postTargets.status, ["awaiting_manual", "failed", "scheduled"])))
    .orderBy(asc(postTargets.scheduledAt));

  const postIds = [...new Set(rows.map((r) => r.post.id))];
  const attachmentRows = postIds.length
    ? await db.select({ attachment: attachments, item: media })
        .from(attachments).innerJoin(media, eq(media.id, attachments.mediaId))
        .where(inArray(attachments.postId, postIds)).orderBy(asc(attachments.position))
    : [];

  return rows.map((r) => ({
    ...r,
    media: attachmentRows
      .filter((a) => a.attachment.postId === r.post.id && (a.attachment.targetId === null || a.attachment.targetId === r.target.id))
      .map((a) => a.item),
  }));
}

export async function getBrandTeam(brandId: string) {
  return db.select({ membership: memberships, user: { id: users.id, name: users.name, email: users.email } })
    .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.brandId, brandId)).orderBy(asc(users.name));
}

/** Published posts with their latest metrics snapshot. */
export async function getAnalytics(brandIds: string[], days = 30) {
  if (brandIds.length === 0) return [];
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.select({ target: postTargets, post: posts, channel: channels })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(inArray(posts.brandId, brandIds), eq(postTargets.status, "published"), gte(postTargets.publishedAt, since)))
    .orderBy(desc(postTargets.publishedAt));

  const targetIds = rows.map((r) => r.target.id);
  const snapshots = targetIds.length
    ? await db.select().from(metrics).where(inArray(metrics.targetId, targetIds)).orderBy(desc(metrics.fetchedAt))
    : [];
  const latest = new Map<string, typeof metrics.$inferSelect>();
  for (const s of snapshots) if (!latest.has(s.targetId)) latest.set(s.targetId, s);

  return rows.map((r) => ({ ...r, metrics: latest.get(r.target.id) ?? null }));
}
