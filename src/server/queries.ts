import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db, posts, postTargets, channels, brands, media, attachments, comments, users, memberships, metrics,
  contentIdeas, interactions, links, linkClicks, OPEN_INTERACTION_STATUSES,
} from "@/lib/db";
import type {
  PostStatus, InteractionDirection, InteractionKind, InteractionStatus,
} from "@/lib/db";

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
  /** The plan row this post came from, when it was fanned out rather than written fresh. */
  idea: typeof contentIdeas.$inferSelect | null;
}) | null> {
  const row = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!row) return null;
  const [bundle] = await hydrate([row], [row.brandId]);
  const idea = row.ideaId
    ? await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, row.ideaId) }) ?? null
    : null;
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
  return { ...bundle, comments: commentRows.map((c) => ({ ...c.comment, user: c.user })), targetMedia, idea };
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

/* ------------------------------------------------------------ content plan */

export type IdeaRow = typeof contentIdeas.$inferSelect;

/** One brand's take on an idea, with everything the plan grid shows per lane. */
export type IdeaLane = {
  brand: typeof brands.$inferSelect;
  post: PostRow | null;
  channels: ChannelRow[];
  /** Counted rather than fetched — the grid only shows whether media exists. */
  mediaCount: number;
  /** True when at least one target carries the author's own first comment. */
  hasAuthorComment: boolean;
  /** Latest snapshot across every target, summed. */
  impressions: number;
  commentCount: number;
  /** Minutes between publishing and the author getting back to the comments. */
  replyMinutes: number | null;
};

export type IdeaBoardRow = IdeaRow & {
  lanes: IdeaLane[];
  /** Totals across the lanes — what the plan measures an idea by. */
  reachedImpressions: number;
  totalComments: number;
  /** Clicks on every tracked link this idea's posts carried. */
  clicks: number;
  liveLanes: number;
};

/**
 * The content plan: every idea, with each brand's post beside it.
 *
 * Only the idea-level fields are stored on the idea. Dates, status, channels,
 * impressions and comments are read back from the posts it spawned, so the
 * plan can never disagree with what actually shipped.
 */
export async function getIdeaBoard(ownerId: string, brandIds: string[]): Promise<IdeaBoardRow[]> {
  const ideaRows = await db.select().from(contentIdeas)
    .where(and(eq(contentIdeas.ownerId, ownerId), isNull(contentIdeas.archivedAt)))
    .orderBy(asc(contentIdeas.sequence), asc(contentIdeas.createdAt));
  if (ideaRows.length === 0) return [];

  const ideaIds = ideaRows.map((r) => r.id);
  const brandRows = brandIds.length
    ? await db.select().from(brands).where(and(inArray(brands.id, brandIds), isNull(brands.archivedAt))).orderBy(asc(brands.name))
    : [];

  const postRows = brandIds.length
    ? await db.select().from(posts)
        .where(and(inArray(posts.ideaId, ideaIds), inArray(posts.brandId, brandIds)))
    : [];
  const postIds = postRows.map((p) => p.id);

  const [targetRows, attachmentCounts, snapshots, clicksByIdea] = await Promise.all([
    postIds.length
      ? db.select({ target: postTargets, channel: channels })
          .from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId))
          .where(inArray(postTargets.postId, postIds))
      : [],
    postIds.length
      ? db.select({ postId: attachments.postId, n: sql<number>`count(*)::int` })
          .from(attachments).where(inArray(attachments.postId, postIds)).groupBy(attachments.postId)
      : [],
    postIds.length
      ? db.select({ m: metrics }).from(metrics)
          .innerJoin(postTargets, eq(postTargets.id, metrics.targetId))
          .where(inArray(postTargets.postId, postIds))
          .orderBy(desc(metrics.fetchedAt))
      : [],
    getClicksByIdea(brandIds),
  ]);

  // One snapshot per target — the newest, since metrics are append-only.
  const latestByTarget = new Map<string, typeof metrics.$inferSelect>();
  for (const s of snapshots) if (!latestByTarget.has(s.m.targetId)) latestByTarget.set(s.m.targetId, s.m);

  const mediaCountByPost = new Map(attachmentCounts.map((a) => [a.postId, a.n]));
  const postByIdeaBrand = new Map(postRows.map((p) => [`${p.ideaId}:${p.brandId}`, p]));

  return ideaRows.map((idea) => {
    const lanes: IdeaLane[] = brandRows.map((brand) => {
      const post = postByIdeaBrand.get(`${idea.id}:${brand.id}`) ?? null;
      if (!post) {
        return { brand, post: null, channels: [], mediaCount: 0, hasAuthorComment: false, impressions: 0, commentCount: 0, replyMinutes: null };
      }
      const mine = targetRows.filter((t) => t.target.postId === post.id);
      const snaps = mine.map((t) => latestByTarget.get(t.target.id)).filter(Boolean) as (typeof metrics.$inferSelect)[];
      return {
        brand,
        post,
        channels: mine.map((t) => t.channel),
        mediaCount: mediaCountByPost.get(post.id) ?? 0,
        hasAuthorComment: mine.some((t) => Boolean(t.target.firstComment?.trim())),
        impressions: snaps.reduce((n, s) => n + s.impressions, 0),
        commentCount: snaps.reduce((n, s) => n + s.commentCount, 0),
        replyMinutes:
          post.repliedAt && post.publishedAt
            ? Math.max(0, Math.round((post.repliedAt.getTime() - post.publishedAt.getTime()) / 60_000))
            : null,
      };
    });

    return {
      ...idea,
      lanes,
      reachedImpressions: lanes.reduce((n, l) => n + l.impressions, 0),
      totalComments: lanes.reduce((n, l) => n + l.commentCount, 0),
      clicks: clicksByIdea.get(idea.id) ?? 0,
      liveLanes: lanes.filter((l) => l.post).length,
    };
  });
}

/* --------------------------------------------------------------- engagement */

export type EngagementItem = {
  interaction: typeof interactions.$inferSelect;
  brand: typeof brands.$inferSelect;
  channel: ChannelRow | null;
  post: { id: string; title: string } | null;
  assignee: { id: string; name: string } | null;
};

export type EngagementCounts = {
  open: number;
  overdue: number;
  dueToday: number;
  repliedToday: number;
  /** The clock these counts were taken against, handed to the client so both
   *  sides agree about what is late. */
  now: number;
};

/**
 * Everything waiting on a person across every brand, worst first.
 *
 * "Worst" is deliberately not just oldest: a late item from someone with a big
 * audience is worth more than an on-time one from nobody, so overdue and
 * priority sort ahead of arrival time.
 */
export async function getEngagementQueue(opts: {
  brandIds: string[];
  statuses?: readonly InteractionStatus[];
  kinds?: readonly InteractionKind[];
  direction?: InteractionDirection;
  search?: string;
  limit?: number;
}): Promise<EngagementItem[]> {
  if (opts.brandIds.length === 0) return [];
  const where = [inArray(interactions.brandId, opts.brandIds)];
  if (opts.statuses?.length) where.push(inArray(interactions.status, [...opts.statuses]));
  if (opts.kinds?.length) where.push(inArray(interactions.kind, [...opts.kinds]));
  if (opts.direction) where.push(eq(interactions.direction, opts.direction));
  if (opts.search) {
    where.push(sql`(${interactions.body} ILIKE ${"%" + opts.search + "%"}
      OR ${interactions.authorName} ILIKE ${"%" + opts.search + "%"}
      OR ${interactions.authorHandle} ILIKE ${"%" + opts.search + "%"})`);
  }

  const rows = await db
    .select({
      interaction: interactions,
      brand: brands,
      channel: channels,
      post: { id: posts.id, title: posts.title },
      assignee: { id: users.id, name: users.name },
    })
    .from(interactions)
    .innerJoin(brands, eq(brands.id, interactions.brandId))
    .leftJoin(channels, eq(channels.id, interactions.channelId))
    .leftJoin(posts, eq(posts.id, interactions.postId))
    .leftJoin(users, eq(users.id, interactions.assigneeId))
    .where(and(...where))
    .orderBy(
      // Nulls last, so undated work never jumps a real deadline.
      sql`case when ${interactions.dueAt} is null then 1 else 0 end`,
      asc(interactions.dueAt),
      sql`case ${interactions.priority} when 'high' then 0 when 'normal' then 1 else 2 end`,
      desc(interactions.receivedAt),
    )
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({
    ...r,
    channel: r.channel ?? null,
    post: r.post?.id ? r.post : null,
    assignee: r.assignee?.id ? r.assignee : null,
  }));
}

/** The numbers on the engagement header, and the nav badge. */
export async function getEngagementCounts(brandIds: string[]): Promise<EngagementCounts> {
  const now = new Date();
  if (brandIds.length === 0) return { open: 0, overdue: 0, dueToday: 0, repliedToday: 0, now: now.getTime() };
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const open = inArray(interactions.status, [...OPEN_INTERACTION_STATUSES]);

  const [[openRow], [overdueRow], [todayRow], [repliedRow]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(interactions)
      .where(and(inArray(interactions.brandId, brandIds), open)),
    db.select({ n: sql<number>`count(*)::int` }).from(interactions)
      .where(and(inArray(interactions.brandId, brandIds), open, lte(interactions.dueAt, now))),
    db.select({ n: sql<number>`count(*)::int` }).from(interactions)
      .where(and(inArray(interactions.brandId, brandIds), open, gte(interactions.dueAt, now), lte(interactions.dueAt, endOfDay))),
    db.select({ n: sql<number>`count(*)::int` }).from(interactions)
      .where(and(inArray(interactions.brandId, brandIds), gte(interactions.repliedAt, startOfDay))),
  ]);

  return { open: openRow.n, overdue: overdueRow.n, dueToday: todayRow.n, repliedToday: repliedRow.n, now: now.getTime() };
}

/* ------------------------------------------------------------ tracked links */

export type LinkRow = typeof links.$inferSelect & {
  brand: { id: string; name: string; color: string };
  post: { id: string; title: string } | null;
  channel: { platform: string; handle: string } | null;
};

export async function getLinks(brandIds: string[], opts: { includeArchived?: boolean } = {}) {
  if (brandIds.length === 0) return [];
  const where = [inArray(links.brandId, brandIds)];
  if (!opts.includeArchived) where.push(isNull(links.archivedAt));

  const rows = await db
    .select({
      link: links,
      brand: { id: brands.id, name: brands.name, color: brands.color },
      post: { id: posts.id, title: posts.title },
      channel: { platform: channels.platform, handle: channels.handle },
    })
    .from(links)
    .innerJoin(brands, eq(brands.id, links.brandId))
    .leftJoin(posts, eq(posts.id, links.postId))
    .leftJoin(channels, eq(channels.id, links.channelId))
    .where(and(...where))
    .orderBy(desc(links.clickCount), desc(links.createdAt))
    .limit(500);

  return rows.map((r) => ({
    ...r.link,
    brand: r.brand,
    post: r.post?.id ? r.post : null,
    channel: r.channel?.platform ? r.channel : null,
  })) as LinkRow[];
}

/** Traffic totals plus the split that actually answers "where from?". */
export async function getTrafficSummary(brandIds: string[], days = 30) {
  const now = Date.now();
  if (brandIds.length === 0) {
    return { clicks: 0, uniques: 0, byPlatform: [] as { platform: string; clicks: number; uniques: number }[], byDay: [] as { day: string; clicks: number }[], now };
  }
  const since = new Date(now - days * 86400_000);
  const scope = and(
    inArray(links.brandId, brandIds),
    gte(linkClicks.clickedAt, since),
    eq(linkClicks.isBot, false),
  );

  const [[totals], byPlatform, byDay] = await Promise.all([
    db.select({
      clicks: sql<number>`count(*)::int`,
      uniques: sql<number>`count(distinct ${linkClicks.visitorHash})::int`,
    }).from(linkClicks).innerJoin(links, eq(links.id, linkClicks.linkId)).where(scope),

    db.select({
      // A link with no channel is a bare brand link, not an unknown platform.
      platform: sql<string>`coalesce(${links.utmSource}, 'direct')`,
      clicks: sql<number>`count(*)::int`,
      uniques: sql<number>`count(distinct ${linkClicks.visitorHash})::int`,
    }).from(linkClicks).innerJoin(links, eq(links.id, linkClicks.linkId)).where(scope)
      .groupBy(sql`coalesce(${links.utmSource}, 'direct')`)
      .orderBy(desc(sql`count(*)`)),

    db.select({
      day: sql<string>`to_char(${linkClicks.clickedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      clicks: sql<number>`count(*)::int`,
    }).from(linkClicks).innerJoin(links, eq(links.id, linkClicks.linkId)).where(scope)
      .groupBy(sql`to_char(${linkClicks.clickedAt} at time zone 'UTC', 'YYYY-MM-DD')`)
      .orderBy(asc(sql`to_char(${linkClicks.clickedAt} at time zone 'UTC', 'YYYY-MM-DD')`)),
  ]);

  return { clicks: totals?.clicks ?? 0, uniques: totals?.uniques ?? 0, byPlatform, byDay, now };
}

/** Clicks per idea, so the plan can be read by what actually moved people. */
export async function getClicksByIdea(brandIds: string[]): Promise<Map<string, number>> {
  if (brandIds.length === 0) return new Map();
  const rows = await db
    .select({ ideaId: links.ideaId, clicks: sql<number>`sum(${links.clickCount})::int` })
    .from(links)
    .where(and(inArray(links.brandId, brandIds), sql`${links.ideaId} is not null`))
    .groupBy(links.ideaId);
  return new Map(rows.filter((r) => r.ideaId).map((r) => [r.ideaId as string, r.clicks ?? 0]));
}

/** Every tracked link on one post, for the composer's link panel. */
export async function getPostLinks(postId: string) {
  return db
    .select({ link: links, channel: { platform: channels.platform, handle: channels.handle } })
    .from(links)
    .leftJoin(channels, eq(channels.id, links.channelId))
    .where(and(eq(links.postId, postId), isNull(links.archivedAt)))
    .orderBy(asc(links.createdAt));
}
