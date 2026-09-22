import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  db, masterPosts, masterPostComments, posts, postTargets, attachments, channels, media, users,
  type MasterSnapshot,
} from "@/lib/db";
import { defaultOptions } from "@/lib/platforms";
import { platformMeta } from "@/lib/platforms/meta";
import { atLeast, type BrandWithRole } from "@/lib/auth";
import {
  MASTER_FIELDS, copyState, fromValues, isLockedStatus, toValues,
  type MasterField, type MasterValues, type CopyState,
} from "@/lib/masters";

export type MasterRow = typeof masterPosts.$inferSelect;
type PostRow = typeof posts.$inferSelect;

export function masterValues(m: MasterRow): MasterValues {
  return toValues(m);
}

async function postMediaIds(postIds: string[]) {
  const byPost = new Map<string, string[]>();
  if (postIds.length === 0) return byPost;
  const rows = await db.select().from(attachments)
    .where(and(inArray(attachments.postId, postIds), isNull(attachments.targetId)))
    .orderBy(asc(attachments.position));
  for (const r of rows) {
    const list = byPost.get(r.postId) ?? [];
    list.push(r.mediaId);
    byPost.set(r.postId, list);
  }
  return byPost;
}

function copyValues(p: PostRow, mediaIds: string[]): MasterValues {
  return toValues({ ...p, mediaIds });
}

/**
 * Who may do what with a master. Anyone on a brand that carries a copy may
 * read it and comment; changing it writes into every copy, so that needs the
 * author, or editor rights on every brand it reaches.
 */
export function masterAccess(m: MasterRow, copyBrandIds: string[], userId: string, mine: BrandWithRole[]) {
  const role = new Map(mine.map((b) => [b.id, b.role]));
  const isOwner = m.ownerId === userId;
  const canView = isOwner || copyBrandIds.some((id) => role.has(id));
  const canEdit = isOwner || (copyBrandIds.length > 0 && copyBrandIds.every((id) => {
    const r = role.get(id);
    return r ? atLeast(r, "editor") : false;
  }));
  return { canView, canEdit, isOwner };
}

export type MasterCopySummary = {
  postId: string;
  brandId: string;
  status: PostRow["status"];
  scheduledAt: Date | null;
} & CopyState;

export type MasterSummary = MasterRow & { copies: MasterCopySummary[]; commentCount: number };

async function summarise(masters: MasterRow[]): Promise<MasterSummary[]> {
  if (masters.length === 0) return [];
  const ids = masters.map((m) => m.id);
  const copies = await db.select().from(posts).where(inArray(posts.masterPostId, ids));
  const mediaByPost = await postMediaIds(copies.map((c) => c.id));
  const commentRows = await db.select({ masterPostId: masterPostComments.masterPostId })
    .from(masterPostComments).where(inArray(masterPostComments.masterPostId, ids));

  return masters.map((m) => {
    const values = masterValues(m);
    return {
      ...m,
      commentCount: commentRows.filter((c) => c.masterPostId === m.id).length,
      copies: copies.filter((c) => c.masterPostId === m.id).map((c) => ({
        postId: c.id,
        brandId: c.brandId,
        status: c.status,
        scheduledAt: c.scheduledAt,
        ...copyState(copyValues(c, mediaByPost.get(c.id) ?? []), c.masterSnapshot, values),
      })),
    };
  });
}

/** Masters this person wrote, plus any that reach a brand they are on. */
export async function listMasters(userId: string, brandIds: string[], search?: string): Promise<MasterSummary[]> {
  const reaching = brandIds.length
    ? await db.selectDistinct({ id: posts.masterPostId }).from(posts)
        .where(and(inArray(posts.brandId, brandIds), isNotNull(posts.masterPostId)))
    : [];
  const ids = reaching.map((r) => r.id!).filter(Boolean);
  const rows = await db.select().from(masterPosts)
    .where(ids.length ? or(eq(masterPosts.ownerId, userId), inArray(masterPosts.id, ids)) : eq(masterPosts.ownerId, userId))
    .orderBy(desc(masterPosts.updatedAt))
    .limit(200);
  const q = search?.trim().toLowerCase();
  const filtered = q ? rows.filter((m) => `${m.title}\n${m.body}\n${m.campaign ?? ""}`.toLowerCase().includes(q)) : rows;
  return summarise(filtered);
}

export async function getMaster(masterId: string) {
  const m = await db.query.masterPosts.findFirst({ where: eq(masterPosts.id, masterId) });
  if (!m) return null;
  const [summary] = await summarise([m]);
  const commentRows = await db.select({ comment: masterPostComments, user: { name: users.name } })
    .from(masterPostComments).leftJoin(users, eq(users.id, masterPostComments.userId))
    .where(eq(masterPostComments.masterPostId, masterId)).orderBy(asc(masterPostComments.createdAt));
  const mediaRows = m.mediaIds.length ? await db.select().from(media).where(inArray(media.id, m.mediaIds)) : [];
  const mediaById = new Map(mediaRows.map((r) => [r.id, r]));
  return {
    ...summary,
    media: m.mediaIds.map((id) => mediaById.get(id)).filter((x): x is typeof media.$inferSelect => Boolean(x)),
    comments: commentRows.map((c) => ({ ...c.comment, author: c.user?.name ?? "Someone" })),
  };
}

/** The per-copy picture a brand's post page needs. */
export async function getCopyContext(post: PostRow, mediaIds: string[]) {
  if (!post.masterPostId) return null;
  const master = await getMaster(post.masterPostId);
  if (!master) return null;
  const values = masterValues(master);
  return {
    master,
    values,
    state: copyState(copyValues(post, mediaIds), post.masterSnapshot, values),
  };
}

/* ---------------------------------------------------------------- writing */

async function writeMedia(postId: string, mediaIds: string[]) {
  await db.delete(attachments).where(and(eq(attachments.postId, postId), isNull(attachments.targetId)));
  for (const [i, mediaId] of mediaIds.entries()) {
    await db.insert(attachments).values({ postId, mediaId, position: i });
  }
}

/**
 * Brings one copy up to date with its master.
 *
 * `accept` takes the master's value whatever the copy had; `keep` marks the
 * master's change as seen without taking it. Anything else pending is taken
 * only where the copy has not customised it and has not been signed off.
 */
export async function syncCopy(
  postId: string,
  opts: { accept?: MasterField[]; keep?: MasterField[] } = {},
) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post?.masterPostId) return;
  const master = await db.query.masterPosts.findFirst({ where: eq(masterPosts.id, post.masterPostId) });
  if (!master) return;

  const target = masterValues(master);
  const current = copyValues(post, (await postMediaIds([postId])).get(postId) ?? []);
  const state = copyState(current, post.masterSnapshot, target);
  const locked = isLockedStatus(post.status);

  const next: Partial<MasterValues> = {};
  const snapshot: MasterSnapshot = { ...post.masterSnapshot };
  for (const f of MASTER_FIELDS) {
    const take = opts.accept?.includes(f)
      || (state.pending.includes(f) && !state.customised.includes(f) && !locked);
    if (take && current[f] !== target[f]) next[f] = target[f];
    // In step with the master, or told to be: either way this is the new base.
    if (take || opts.keep?.includes(f) || current[f] === target[f]) snapshot[f] = target[f];
  }

  const { mediaIds, ...fields } = fromValues(next);
  const changed = Object.keys(next).length > 0;
  await db.update(posts).set({ ...fields, masterSnapshot: snapshot, ...(changed ? { updatedAt: new Date() } : {}) })
    .where(eq(posts.id, postId));
  if (mediaIds) await writeMedia(postId, mediaIds);
  if (fields.scheduledAt !== undefined) {
    await db.update(postTargets).set({ scheduledAt: fields.scheduledAt })
      .where(and(eq(postTargets.postId, postId), inArray(postTargets.status, ["pending", "scheduled", "failed"])));
  }
}

export async function syncAllCopies(masterId: string) {
  const copies = await db.select({ id: posts.id }).from(posts).where(eq(posts.masterPostId, masterId));
  for (const c of copies) await syncCopy(c.id);
  return copies.length;
}

/**
 * A new draft in one brand, filled from the master, pointed at that brand's
 * channels on the master's platforms.
 */
export async function createCopy(master: MasterRow, brandId: string, userId: string) {
  const values = masterValues(master);
  const [row] = await db.insert(posts).values({
    brandId,
    masterPostId: master.id,
    masterSnapshot: { ...values },
    title: master.title,
    body: master.body,
    campaign: master.campaign,
    tags: master.tags,
    scheduledAt: master.scheduledAt,
    status: "draft",
    createdBy: userId,
  }).returning();

  await writeMedia(row.id, master.mediaIds);

  if (master.platforms.length) {
    const chans = await db.select().from(channels).where(and(
      eq(channels.brandId, brandId), isNull(channels.archivedAt), inArray(channels.platform, master.platforms),
    ));
    for (const c of chans) {
      await db.insert(postTargets).values({
        postId: row.id, channelId: c.id, status: "pending", scheduledAt: master.scheduledAt,
        options: { ...defaultOptions(c.platform), ...((c.settings ?? {}) as Record<string, unknown>) },
      });
    }
  }
  return row;
}

/** Libraries, platforms and brands the master editor offers, across a person's brands. */
export async function getMasterEditorData(mine: BrandWithRole[]) {
  const ids = mine.map((b) => b.id);
  const [mediaRows, channelRows] = ids.length
    ? await Promise.all([
        db.select().from(media).where(inArray(media.brandId, ids)).orderBy(desc(media.createdAt)).limit(300),
        db.selectDistinct({ platform: channels.platform }).from(channels)
          .where(and(inArray(channels.brandId, ids), isNull(channels.archivedAt))),
      ])
    : [[], []];
  const brandById = new Map(mine.map((b) => [b.id, b]));
  const meta = new Map(platformMeta().map((p) => [p.id as string, p]));
  return {
    brands: mine.map((b) => ({ id: b.id, name: b.name, color: b.color, canEdit: atLeast(b.role, "editor") })),
    media: mediaRows.map((m) => ({
      id: m.id, url: m.url, kind: m.kind, originalName: m.originalName,
      brandColor: brandById.get(m.brandId)?.color ?? "#888", brandName: brandById.get(m.brandId)?.name ?? "",
    })),
    platforms: channelRows
      .map((c) => meta.get(c.platform))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id as string, name: p.name, color: p.color }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    timezone: mine[0]?.timezone ?? "UTC",
  };
}
