"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, media } from "@/lib/db";
import { requireBrandRole } from "@/lib/auth";
import { storeUpload, kindFromMime } from "@/server/media";

const MAX_BYTES = 200 * 1024 * 1024;

export async function uploadMediaAction(brandId: string, formData: FormData) {
  const { user } = await requireBrandRole(brandId, "editor");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const saved: string[] = [];

  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over the 200 MB limit.`);
    const stored = await storeUpload(file);
    const [row] = await db.insert(media).values({
      brandId,
      kind: kindFromMime(file.type),
      url: stored.url,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: stored.size,
      uploadedBy: user.id,
    }).returning();
    saved.push(row.id);
  }
  revalidatePath("/", "layout");
  return saved;
}

export async function updateMediaAction(mediaId: string, formData: FormData) {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row) throw new Error("Media not found");
  await requireBrandRole(row.brandId, "editor");
  await db.update(media).set({
    altText: String(formData.get("altText") ?? "") || null,
    tags: String(formData.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
  }).where(eq(media.id, mediaId));
  revalidatePath("/library");
}

export async function deleteMediaAction(mediaId: string) {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row) return;
  await requireBrandRole(row.brandId, "editor");
  await db.delete(media).where(eq(media.id, mediaId));
  revalidatePath("/library");
}

export async function listBrandMedia(brandId: string, ids?: string[]) {
  await requireBrandRole(brandId, "viewer");
  return db.select().from(media).where(
    ids?.length ? and(eq(media.brandId, brandId), inArray(media.id, ids)) : eq(media.brandId, brandId),
  );
}
