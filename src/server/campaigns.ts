import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, campaigns, campaignComments, posts, masterPosts, users } from "@/lib/db";
import { can, type BrandWithRole } from "@/lib/auth";
import { inheritState, planSync } from "@/lib/masters";
import {
  CAMPAIGN_FIELDS, campaignColumns, campaignValues, type CampaignField, type CampaignValues,
} from "@/lib/campaigns";
import { masterAccess, syncAllCopies } from "@/server/masters";

export type CampaignRow = typeof campaigns.$inferSelect;

export function campaignState(copy: CampaignRow, master: CampaignRow) {
  return inheritState(CAMPAIGN_FIELDS, campaignValues(copy), copy.masterSnapshot, campaignValues(master));
}

/* ------------------------------------------------------------------ access */

/**
 * A brand campaign follows that brand's roles. A master campaign follows the
 * master-post rule: visible across the brands it reaches, editable by its
 * author or by someone who can edit every one of them.
 */
export async function campaignAccess(c: CampaignRow, userId: string, mine: BrandWithRole[]) {
  if (c.brandId) {
    const b = mine.find((x) => x.id === c.brandId);
    return { canView: Boolean(b), canEdit: b ? can.edit(b.role) : false };
  }
  const copies = await db.select({ brandId: campaigns.brandId }).from(campaigns).where(eq(campaigns.masterId, c.id));
  const { canView, canEdit } = masterAccess(c, copies.map((x) => x.brandId!), userId, mine);
  return { canView, canEdit };
}

/* ------------------------------------------------------------------ reading */

/** Posts carrying each campaign name, per brand — "brandId\u001fname" → counts. */
async function postCounts(brandIds: string[]) {
  const counts = new Map<string, { total: number; published: number }>();
  if (brandIds.length === 0) return counts;
  const rows = await db.select({
    brandId: posts.brandId,
    campaign: posts.campaign,
    total: sql<number>`count(*)::int`,
    published: sql<number>`count(*) filter (where ${posts.status} in ('published','partially_published'))::int`,
  }).from(posts)
    .where(and(inArray(posts.brandId, brandIds), isNotNull(posts.campaign)))
    .groupBy(posts.brandId, posts.campaign);
  for (const r of rows) counts.set(`${r.brandId}\u001f${r.campaign}`, { total: r.total, published: r.published });
  return counts;
}

export type CampaignCopySummary = {
  id: string; brandId: string; status: CampaignRow["status"];
  customised: CampaignField[]; pending: CampaignField[];
  posts: number; published: number;
};
export type CampaignSummary = CampaignRow & {
  copies: CampaignCopySummary[];
  /** For a brand copy: its master's name, and fields waiting on a decision. */
  masterName: string | null;
  pending: CampaignField[];
  posts: number;
  published: number;
};

async function summarise(rows: CampaignRow[]): Promise<CampaignSummary[]> {
  if (rows.length === 0) return [];
  const masterIds = rows.filter((r) => !r.brandId).map((r) => r.id);
  const linkedMasterIds = rows.map((r) => r.masterId).filter((x): x is string => Boolean(x));
  const [copies, masters] = await Promise.all([
    masterIds.length
      ? db.select().from(campaigns).where(and(inArray(campaigns.masterId, masterIds), isNull(campaigns.archivedAt)))
      : [],
    linkedMasterIds.length ? db.select().from(campaigns).where(inArray(campaigns.id, linkedMasterIds)) : [],
  ]);
  const brandIds = [...new Set([...rows, ...copies].map((r) => r.brandId).filter((x): x is string => Boolean(x)))];
  const counts = await postCounts(brandIds);
  const count = (r: CampaignRow) => counts.get(`${r.brandId}\u001f${r.name}`) ?? { total: 0, published: 0 };
  const masterById = new Map(masters.map((m) => [m.id, m]));

  return rows.map((r) => {
    const own = r.brandId ? count(r) : { total: 0, published: 0 };
    const master = r.masterId ? masterById.get(r.masterId) : undefined;
    const rowCopies = copies.filter((c) => c.masterId === r.id).map((c) => ({
      id: c.id, brandId: c.brandId!, status: c.status,
      ...campaignState(c, r), posts: count(c).total, published: count(c).published,
    }));
    return {
      ...r,
      copies: rowCopies,
      masterName: master?.name ?? null,
      pending: master ? campaignState(r, master).pending : [],
      posts: r.brandId ? own.total : rowCopies.reduce((n, c) => n + c.posts, 0),
      published: r.brandId ? own.published : rowCopies.reduce((n, c) => n + c.published, 0),
    };
  });
}

/** Master campaigns this person wrote or that reach one of their brands. */
export async function listMasterCampaigns(userId: string, brandIds: string[]) {
  const reaching = brandIds.length
    ? await db.selectDistinct({ id: campaigns.masterId }).from(campaigns)
        .where(and(inArray(campaigns.brandId, brandIds), isNotNull(campaigns.masterId)))
    : [];
  const ids = reaching.map((r) => r.id!).filter(Boolean);
  const mineOrReaching = ids.length ? or(eq(campaigns.ownerId, userId), inArray(campaigns.id, ids)) : eq(campaigns.ownerId, userId);
  const rows = await db.select().from(campaigns)
    .where(and(isNull(campaigns.brandId), isNull(campaigns.archivedAt), mineOrReaching))
    .orderBy(desc(campaigns.updatedAt));
  return summarise(rows);
}

export async function listBrandCampaigns(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  const rows = await db.select().from(campaigns)
    .where(and(inArray(campaigns.brandId, brandIds), isNull(campaigns.archivedAt)))
    .orderBy(desc(campaigns.updatedAt));
  return summarise(rows);
}

/** Names for the composer's campaign picker, per brand. */
export async function campaignNamesByBrand(brandIds: string[]) {
  const out: Record<string, string[]> = {};
  if (brandIds.length === 0) return out;
  const rows = await db.select({ brandId: campaigns.brandId, name: campaigns.name }).from(campaigns)
    .where(and(inArray(campaigns.brandId, brandIds), isNull(campaigns.archivedAt)))
    .orderBy(asc(campaigns.name));
  for (const r of rows) (out[r.brandId!] ??= []).push(r.name);
  return out;
}

/** The brief a post's campaign label points at, if it names one of the brand's campaigns. */
export async function findBrandCampaign(brandId: string, name: string | null) {
  if (!name) return null;
  return await db.query.campaigns.findFirst({
    where: and(eq(campaigns.brandId, brandId), eq(campaigns.name, name), isNull(campaigns.archivedAt)),
  }) ?? null;
}

async function commentsFor(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db.select({ comment: campaignComments, user: { name: users.name } })
    .from(campaignComments).leftJoin(users, eq(users.id, campaignComments.userId))
    .where(inArray(campaignComments.campaignId, ids)).orderBy(asc(campaignComments.createdAt));
  return rows.map((r) => ({ ...r.comment, author: r.user?.name ?? "Someone" }));
}

export async function getCampaign(id: string) {
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!row) return null;
  const [summary] = await summarise([row]);
  const master = row.masterId ? await db.query.campaigns.findFirst({ where: eq(campaigns.id, row.masterId) }) ?? null : null;

  // The posts in it: this brand's, or for a master every copy's (under each
  // copy's own name) plus the author's master posts.
  const copyRows = row.brandId ? [] : await db.select().from(campaigns).where(and(eq(campaigns.masterId, row.id), isNull(campaigns.archivedAt)));
  const postPairs = row.brandId
    ? [and(eq(posts.brandId, row.brandId), eq(posts.campaign, row.name))]
    : copyRows.map((c) => and(eq(posts.brandId, c.brandId!), eq(posts.campaign, c.name)));
  const postRows = postPairs.length
    ? await db.select({
        id: posts.id, brandId: posts.brandId, title: posts.title, body: posts.body,
        status: posts.status, scheduledAt: posts.scheduledAt, masterPostId: posts.masterPostId,
      }).from(posts).where(or(...postPairs)).orderBy(desc(sql`coalesce(${posts.scheduledAt}, ${posts.updatedAt})`)).limit(100)
    : [];
  const masterPostRows = row.brandId ? [] : await db.select({ id: masterPosts.id, title: masterPosts.title, body: masterPosts.body })
    .from(masterPosts).where(and(eq(masterPosts.ownerId, row.ownerId), eq(masterPosts.campaign, row.name)))
    .orderBy(desc(masterPosts.updatedAt));

  return {
    ...summary,
    master,
    state: master ? campaignState(row, master) : null,
    comments: await commentsFor([row.id]),
    masterComments: master ? await commentsFor([master.id]) : [],
    posts: postRows,
    masterPosts: masterPostRows,
  };
}

/* ------------------------------------------------------------------ writing */

/**
 * A campaign's name is the label on its posts, so renaming one renames the
 * label on that brand's posts — and, for a master, on the author's master
 * posts, whose copies then follow.
 */
export async function renameCampaignLabel(row: CampaignRow, from: string, to: string) {
  if (from === to) return;
  if (row.brandId) {
    await db.update(posts).set({ campaign: to })
      .where(and(eq(posts.brandId, row.brandId), eq(posts.campaign, from)));
    return;
  }
  const moved = await db.update(masterPosts).set({ campaign: to, updatedAt: new Date() })
    .where(and(eq(masterPosts.ownerId, row.ownerId), eq(masterPosts.campaign, from)))
    .returning({ id: masterPosts.id });
  for (const m of moved) await syncAllCopies(m.id);
}

/** Brings one brand campaign up to date with its master. Same rules as posts, never locked. */
export async function syncCampaignCopy(id: string, opts: { accept?: CampaignField[]; keep?: CampaignField[] } = {}) {
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!row?.masterId) return;
  const master = await db.query.campaigns.findFirst({ where: eq(campaigns.id, row.masterId) });
  if (!master) return;

  const { next, snapshot } = planSync(CAMPAIGN_FIELDS, campaignValues(row), row.masterSnapshot, campaignValues(master), opts);
  const changed = Object.keys(next).length > 0;
  await db.update(campaigns)
    .set({ ...campaignColumns(next), masterSnapshot: snapshot, ...(changed ? { updatedAt: new Date() } : {}) })
    .where(eq(campaigns.id, id));
  if (next.name !== undefined) await renameCampaignLabel(row, row.name, next.name);
}

export async function syncAllCampaignCopies(masterId: string) {
  const copies = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.masterId, masterId));
  for (const c of copies) await syncCampaignCopy(c.id);
  return copies.length;
}

export async function createCampaignCopy(master: CampaignRow, brandId: string, userId: string) {
  const values: CampaignValues = campaignValues(master);
  const [row] = await db.insert(campaigns).values({
    ...campaignColumns(values),
    name: master.name,
    brandId,
    ownerId: userId,
    masterId: master.id,
    masterSnapshot: { ...values },
    status: master.status,
  }).returning();
  return row;
}

/** Master campaign names for the master post editor's campaign picker. */
export async function masterCampaignNames(userId: string) {
  const rows = await db.select({ name: campaigns.name }).from(campaigns)
    .where(and(isNull(campaigns.brandId), isNull(campaigns.archivedAt), eq(campaigns.ownerId, userId)))
    .orderBy(asc(campaigns.name));
  return rows.map((r) => r.name);
}
