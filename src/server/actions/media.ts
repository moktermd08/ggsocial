"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, brands, media, masterPosts, posts } from "@/lib/db";
import { requireBrandRole, requireUser } from "@/lib/auth";
import { storeUpload, kindFromMime } from "@/server/media";
import { syncCopy } from "@/server/masters";
import { cleanCatalog } from "@/lib/media-catalog";
import { catalogueWithClaude, saveCatalog } from "@/server/media-catalog";
import { masterAssets, masterOwnersFor } from "@/server/media-library";

const MAX_BYTES = 200 * 1024 * 1024;

/** Pixel size and length the browser read before upload, one per file in order. Never trusted beyond being numbers. */
function readDims(formData: FormData, count: number) {
  let raw: unknown = [];
  try { raw = JSON.parse(String(formData.get("dims") ?? "[]")); } catch { /* sent without sizes */ }
  const list = Array.isArray(raw) ? raw : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  return Array.from({ length: count }, (_, i) => {
    const d = (list[i] ?? {}) as Record<string, unknown>;
    return { width: num(d.width), height: num(d.height), durationMs: num(d.durationMs) };
  });
}

async function storeAll(formData: FormData, row: { brandId: string | null; ownerId?: string | null; masterMediaId?: string | null }, userId: string) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const dims = readDims(formData, files.length);
  const saved: string[] = [];
  for (const [i, file] of files.entries()) {
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
      ...dims[i],
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
    const firstIndex = formData.getAll("files").indexOf(first);
    fd.append("dims", JSON.stringify([readDims(formData, firstIndex + 1)[firstIndex]]));

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

/** Files a library item by hand: what it shows, its shelf, keywords and where it suits. */
export async function saveMediaCatalogAction(mediaId: string, input: {
  altText?: string | null; category?: string | null; subcategory?: string | null;
  tags?: string[]; uses?: string[]; usageNotes?: string | null;
}) {
  return asResult(async () => {
    const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
    if (!row) throw new Error("That file is gone.");
    const { user } = await requireMediaEdit(row);
    const fields = cleanCatalog(input);
    await saveCatalog(mediaId, fields, user.id);
    revalidatePath("/library");
    return { fields };
  });
}

/** How many images one call files. Keeps a click well inside the proxy's timeout. */
const CATALOGUE_BATCH = 6;

/**
 * Has Claude look at each image and file it. The library page calls this in
 * batches until nothing is left, so a big import is catalogued in one click.
 */
export async function catalogueMediaAction(mediaIds: string[]) {
  return asResult(async () => {
    const ids = [...new Set(mediaIds)].slice(0, CATALOGUE_BATCH);
    const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
    const done: { id: string; fields: ReturnType<typeof cleanCatalog> }[] = [];
    const failed: { id: string; name: string; error: string }[] = [];
    await Promise.all(rows.map(async (row) => {
      try {
        const { user } = await requireMediaEdit(row);
        const brand = row.brandId ? await db.query.brands.findFirst({ where: eq(brands.id, row.brandId) }) ?? null : null;
        const library = row.brandId
          ? [
              ...await db.select().from(media).where(eq(media.brandId, row.brandId)),
              ...await masterOwnersFor(user.id, [row.brandId]).then(masterAssets),
            ]
          : await masterAssets([row.ownerId ?? user.id]);
        const fields = await catalogueWithClaude(row, { brand, library });
        await saveCatalog(row.id, fields, "claude");
        done.push({ id: row.id, fields });
      } catch (e) {
        failed.push({ id: row.id, name: row.originalName, error: e instanceof Error ? e.message : "Could not catalogue it." });
      }
    }));
    if (done.length) revalidatePath("/library");
    return { done, failed };
  });
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
