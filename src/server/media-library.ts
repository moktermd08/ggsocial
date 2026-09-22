import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, media, memberships } from "@/lib/db";

export type MediaFile = typeof media.$inferSelect;

/**
 * Whose master assets a set of brands sees: the owners and admins of those
 * brands. A master library is the agency's, not one person's, so everyone on
 * a brand an admin runs can use it.
 */
export async function masterOwnersFor(userId: string, brandIds: string[]) {
  const rows = brandIds.length
    ? await db.selectDistinct({ userId: memberships.userId }).from(memberships)
        .where(and(inArray(memberships.brandId, brandIds), inArray(memberships.role, ["owner", "admin"])))
    : [];
  return [...new Set([userId, ...rows.map((r) => r.userId)])];
}

export async function masterAssets(ownerIds: string[]) {
  if (ownerIds.length === 0) return [];
  return db.select().from(media)
    .where(and(isNull(media.brandId), inArray(media.ownerId, ownerIds)))
    .orderBy(desc(media.createdAt));
}

/** Each brand's own versions of master assets: brandId → (master id → version). */
export async function brandVersions(brandIds: string[], masterIds?: string[]) {
  const out = new Map<string, Map<string, MediaFile>>();
  if (brandIds.length === 0) return out;
  const rows = await db.select().from(media).where(and(
    inArray(media.brandId, brandIds),
    masterIds ? (masterIds.length ? inArray(media.masterMediaId, masterIds) : isNull(media.id)) : isNotNull(media.masterMediaId),
  )).orderBy(desc(media.createdAt));
  for (const r of rows) {
    const byMaster = out.get(r.brandId!) ?? new Map<string, MediaFile>();
    // Newest wins if a brand ever ends up with two.
    if (!byMaster.has(r.masterMediaId!)) byMaster.set(r.masterMediaId!, r);
    out.set(r.brandId!, byMaster);
  }
  return out;
}

/** Media ids as one brand should use them: master assets swapped for its own versions. */
export function mapForBrand(ids: string[], versions: Map<string, MediaFile> | undefined) {
  return versions ? ids.map((id) => versions.get(id)?.id ?? id) : ids;
}

export type LibraryItem = MediaFile & {
  /** A master asset shown in a brand's library. */
  isMaster: boolean;
  /** For a brand file that is a version of a master asset: that asset. */
  versionOf: MediaFile | null;
};

/**
 * One brand's library as it should read: its own files, then every master
 * asset it has not replaced with a version of its own.
 */
export async function brandLibraries(userId: string, brandIds: string[]) {
  if (brandIds.length === 0) return new Map<string, LibraryItem[]>();
  const [own, masters] = await Promise.all([
    db.select().from(media).where(inArray(media.brandId, brandIds)).orderBy(desc(media.createdAt)),
    masterOwnersFor(userId, brandIds).then(masterAssets),
  ]);
  const masterById = new Map(masters.map((m) => [m.id, m]));
  const out = new Map<string, LibraryItem[]>();
  for (const brandId of brandIds) {
    const mine = own.filter((m) => m.brandId === brandId);
    const replaced = new Set(mine.map((m) => m.masterMediaId).filter(Boolean));
    out.set(brandId, [
      ...mine.map((m) => ({ ...m, isMaster: false, versionOf: m.masterMediaId ? masterById.get(m.masterMediaId) ?? null : null })),
      ...masters.filter((m) => !replaced.has(m.id)).map((m) => ({ ...m, isMaster: true, versionOf: null })),
    ]);
  }
  return out;
}

export async function getMediaFile(id: string) {
  return await db.query.media.findFirst({ where: eq(media.id, id) }) ?? null;
}
