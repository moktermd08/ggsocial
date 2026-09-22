import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, linkDestinations, links } from "@/lib/db";
import { can, type BrandWithRole } from "@/lib/auth";
import { inheritState, planSync } from "@/lib/masters";
import { DEST_FIELDS, destColumns, destValues, type DestField, type DestinationOption } from "@/lib/destinations";
import { masterAccess } from "@/server/masters";

export type DestinationRow = typeof linkDestinations.$inferSelect;

export function destState(copy: DestinationRow, master: DestinationRow) {
  return inheritState(DEST_FIELDS, destValues(copy), copy.masterSnapshot, destValues(master));
}

export async function destinationAccess(d: DestinationRow, userId: string, mine: BrandWithRole[]) {
  if (d.brandId) {
    const b = mine.find((x) => x.id === d.brandId);
    return { canView: Boolean(b), canEdit: b ? can.edit(b.role) : false };
  }
  const copies = await db.select({ brandId: linkDestinations.brandId }).from(linkDestinations)
    .where(and(eq(linkDestinations.masterId, d.id), isNull(linkDestinations.archivedAt)));
  return masterAccess(d, copies.map((c) => c.brandId!), userId, mine);
}

/** Clicks and links issued from each destination, optionally only in some brands. */
async function usage(destIds: string[], brandIds?: string[]) {
  const out = new Map<string, { links: number; clicks: number; uniques: number }>();
  if (destIds.length === 0) return out;
  const rows = await db.select({
    id: links.destinationId,
    n: sql<number>`count(*)::int`,
    clicks: sql<number>`coalesce(sum(${links.clickCount}), 0)::int`,
    uniques: sql<number>`coalesce(sum(${links.uniqueCount}), 0)::int`,
  }).from(links)
    .where(and(inArray(links.destinationId, destIds), brandIds ? inArray(links.brandId, brandIds) : undefined))
    .groupBy(links.destinationId);
  for (const r of rows) out.set(r.id!, { links: r.n, clicks: r.clicks, uniques: r.uniques });
  return out;
}

export type DestinationSummary = DestinationRow & {
  copies: ({ id: string; brandId: string; clicks: number } & ReturnType<typeof destState>)[];
  pending: DestField[];
  /** For a master: its own links plus every copy's. */
  links: number;
  clicks: number;
  uniques: number;
};

async function summarise(rows: DestinationRow[], brandIds: string[]): Promise<DestinationSummary[]> {
  if (rows.length === 0) return [];
  const masterIds = rows.filter((r) => !r.brandId).map((r) => r.id);
  const linked = rows.map((r) => r.masterId).filter((x): x is string => Boolean(x));
  const [copies, masters] = await Promise.all([
    masterIds.length
      ? db.select().from(linkDestinations)
          .where(and(inArray(linkDestinations.masterId, masterIds), isNull(linkDestinations.archivedAt)))
      : [],
    linked.length ? db.select().from(linkDestinations).where(inArray(linkDestinations.id, linked)) : [],
  ]);
  const use = await usage([...rows.map((r) => r.id), ...copies.map((c) => c.id)], brandIds);
  const masterById = new Map(masters.map((m) => [m.id, m]));
  const none = { links: 0, clicks: 0, uniques: 0 };

  return rows.map((r) => {
    const own = use.get(r.id) ?? none;
    const rowCopies = copies.filter((c) => c.masterId === r.id).map((c) => ({
      id: c.id, brandId: c.brandId!, clicks: (use.get(c.id) ?? none).clicks, ...destState(c, r),
    }));
    const copyUse = copies.filter((c) => c.masterId === r.id).map((c) => use.get(c.id) ?? none);
    const master = r.masterId ? masterById.get(r.masterId) : undefined;
    return {
      ...r,
      copies: rowCopies,
      pending: master ? destState(r, master).pending : [],
      links: own.links + copyUse.reduce((n, u) => n + u.links, 0),
      clicks: own.clicks + copyUse.reduce((n, u) => n + u.clicks, 0),
      uniques: own.uniques + copyUse.reduce((n, u) => n + u.uniques, 0),
    };
  });
}

async function masterRows(userId: string, brandIds: string[]) {
  const reaching = brandIds.length
    ? await db.selectDistinct({ id: linkDestinations.masterId }).from(linkDestinations)
        .where(and(inArray(linkDestinations.brandId, brandIds), isNotNull(linkDestinations.masterId)))
    : [];
  const ids = reaching.map((r) => r.id!).filter(Boolean);
  const visible = ids.length ? or(eq(linkDestinations.ownerId, userId), inArray(linkDestinations.id, ids)) : eq(linkDestinations.ownerId, userId);
  return db.select().from(linkDestinations)
    .where(and(isNull(linkDestinations.brandId), isNull(linkDestinations.archivedAt), visible))
    .orderBy(asc(linkDestinations.name));
}

export async function listMasterDestinations(userId: string, brandIds: string[]) {
  return summarise(await masterRows(userId, brandIds), brandIds);
}

export async function listBrandDestinations(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  const rows = await db.select().from(linkDestinations)
    .where(and(inArray(linkDestinations.brandId, brandIds), isNull(linkDestinations.archivedAt)))
    .orderBy(asc(linkDestinations.name));
  return summarise(rows, brandIds);
}

export async function getDestination(id: string, brandIds: string[]) {
  const row = await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, id) });
  if (!row) return null;
  const [summary] = await summarise([row], brandIds);
  const master = row.masterId ? await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, row.masterId) }) ?? null : null;
  return { ...summary, master, state: master ? destState(row, master) : null };
}

/**
 * What each brand's link pickers offer: its own destinations and copies, then
 * any master destination it has no copy of yet.
 */
export async function destinationOptionsByBrand(userId: string, brandIds: string[]) {
  const [brandRows, masters] = await Promise.all([
    brandIds.length
      ? db.select().from(linkDestinations)
          .where(and(inArray(linkDestinations.brandId, brandIds), isNull(linkDestinations.archivedAt)))
          .orderBy(asc(linkDestinations.name))
      : [],
    masterRows(userId, brandIds),
  ]);
  const opt = (d: DestinationRow, fromMaster: boolean): DestinationOption => ({
    id: d.id, name: d.name, url: d.url, utmCampaign: d.utmCampaign, fromMaster,
  });
  const out: Record<string, DestinationOption[]> = {};
  for (const brandId of brandIds) {
    const own = brandRows.filter((d) => d.brandId === brandId);
    const copied = new Set(own.map((d) => d.masterId).filter(Boolean));
    out[brandId] = [...own.map((d) => opt(d, false)), ...masters.filter((m) => !copied.has(m.id)).map((m) => opt(m, true))];
  }
  return out;
}

/* ------------------------------------------------------------------ writing */

/**
 * Points every link issued from this destination at its current values. The
 * UTM fields only override when set, so a link keeps its own campaign and
 * channel handle otherwise.
 */
export async function applyDestinationToLinks(destId: string) {
  const d = await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, destId) });
  if (!d) return;
  await db.update(links).set({
    destination: d.url,
    ...(d.utmCampaign ? { utmCampaign: d.utmCampaign } : {}),
    ...(d.utmContent ? { utmContent: d.utmContent } : {}),
  }).where(eq(links.destinationId, destId));
}

export async function syncDestinationCopy(id: string, opts: { accept?: DestField[]; keep?: DestField[] } = {}) {
  const row = await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, id) });
  if (!row?.masterId) return;
  const master = await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, row.masterId) });
  if (!master) return;
  const { next, snapshot } = planSync(DEST_FIELDS, destValues(row), row.masterSnapshot, destValues(master), opts);
  const changed = Object.keys(next).length > 0;
  await db.update(linkDestinations)
    .set({ ...destColumns(next), masterSnapshot: snapshot, ...(changed ? { updatedAt: new Date() } : {}) })
    .where(eq(linkDestinations.id, id));
  if (changed) await applyDestinationToLinks(id);
}

export async function syncAllDestinationCopies(masterId: string) {
  const copies = await db.select({ id: linkDestinations.id }).from(linkDestinations).where(eq(linkDestinations.masterId, masterId));
  for (const c of copies) await syncDestinationCopy(c.id);
  return copies.length;
}

export async function createDestinationCopy(master: DestinationRow, brandId: string, userId: string) {
  const values = destValues(master);
  const [row] = await db.insert(linkDestinations).values({
    ...destColumns(values), name: master.name, url: master.url,
    brandId, ownerId: userId, masterId: master.id, masterSnapshot: { ...values },
  }).returning();
  return row;
}
