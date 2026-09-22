"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, media, masterPosts, posts } from "@/lib/db";
import { requireBrandRole, requireUser } from "@/lib/auth";
import { storeUpload, kindFromMime } from "@/server/media";
import { syncCopy } from "@/server/masters";

const MAX_BYTES = 200 * 1024 * 1024;

async function storeAll(formData: FormData, row: { brandId: string | null; ownerId?: string | null; masterMediaId?: string | null }, userId: string) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const saved: string[] = [];
  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over the 200 MB limit.`);
    const stored = await storeUpload(file);
    const [inserted] = await db.insert(media).values({
      ...row,
      kind: kindFromMime(file.type),
      url: stored.url,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: stored.size,
      uploadedBy: userId,
    }).returning();
    saved.push(inserted.id);
  }
  return saved;
}

export async function uploadMediaAction(brandId: string, formData: FormData) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "editor");
    const saved = await storeAll(formData, { brandId }, user.id);
    revalidatePath("/", "layout");
    return { ids: saved };
  });
}

/** Uploads into the master library, shared by every brand you run. */
export async function uploadMasterMediaAction(formData: FormData) {
  return asResult(async () => {
    const user = await requireUser();
    const saved = await storeAll(formData, { brandId: null, ownerId: user.id }, user.id);
    revalidatePath("/", "layout");
    return { ids: saved };
  });
}

/**
 * Brand copies of master posts that carry this master asset. They re-sync so
 * a new (or removed) brand version reaches them the same way any master
 * change does: straight in where nobody has signed off, offered otherwise.
 */
async function resyncCopiesUsing(brandId: string, masterMediaId: string) {
  const rows = await db.select({ id: posts.id }).from(posts)
    .innerJoin(masterPosts, eq(masterPosts.id, posts.masterPostId))
    .where(and(eq(posts.brandId, brandId), sql`${masterPosts.mediaIds} @> ${JSON.stringify([masterMediaId])}::jsonb`));
  for (const r of rows) await syncCopy(r.id);
}

/**
 * A brand's own version of a master asset. It replaces the master everywhere
 * in that brand; any earlier version stays in the library as a plain file.
 */
export async function uploadBrandVersionAction(brandId: string, masterMediaId: string, formData: FormData) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "editor");
    const master = await db.query.media.findFirst({ where: eq(media.id, masterMediaId) });
    if (!master || master.brandId) throw new Error("That is not a master asset.");
    const first = formData.getAll("files").find((f): f is File => f instanceof File && f.size > 0);
    if (!first) throw new Error("Choose a file.");
    const fd = new FormData();
    fd.append("files", first);

    await db.update(media).set({ masterMediaId: null })
      .where(and(eq(media.brandId, brandId), eq(media.masterMediaId, masterMediaId)));
    const [id] = await storeAll(fd, { brandId, masterMediaId }, user.id);
    await resyncCopiesUsing(brandId, masterMediaId);
    revalidatePath("/", "layout");
    return { id };
  });
}

/** Goes back to the master asset in this brand. The brand's file stays in its library. */
export async function clearBrandVersionAction(mediaId: string) {
  return asResult(async () => {
    const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
    if (!row?.brandId || !row.masterMediaId) return;
    await requireBrandRole(row.brandId, "editor");
    await db.update(media).set({ masterMediaId: null }).where(eq(media.id, mediaId));
    await resyncCopiesUsing(row.brandId, row.masterMediaId);
    revalidatePath("/", "layout");
  });
}

/** A brand file needs editor on its brand; a master asset, its owner. */
async function requireMediaEdit(row: typeof media.$inferSelect) {
  if (row.brandId) return requireBrandRole(row.brandId, "editor");
  const user = await requireUser();
  if (row.ownerId !== user.id) throw new Error("Only the owner of a master asset can change it.");
  return { user };
}

export async function updateMediaAction(mediaId: string, formData: FormData) {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row) throw new Error("Media not found");
  await requireMediaEdit(row);
  await db.update(media).set({
    altText: String(formData.get("altText") ?? "") || null,
    tags: String(formData.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
  }).where(eq(media.id, mediaId));
  revalidatePath("/library");
}

export async function deleteMediaAction(mediaId: string) {
  return asResult(async () => {
    const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
    if (!row) return;
    await requireMediaEdit(row);
    await db.delete(media).where(eq(media.id, mediaId));
    if (row.brandId && row.masterMediaId) await resyncCopiesUsing(row.brandId, row.masterMediaId);
    revalidatePath("/", "layout");
  });
}

export async function listBrandMedia(brandId: string, ids?: string[]) {
  await requireBrandRole(brandId, "viewer");
  return db.select().from(media).where(
    ids?.length ? and(eq(media.brandId, brandId), inArray(media.id, ids)) : eq(media.brandId, brandId),
  );
}
