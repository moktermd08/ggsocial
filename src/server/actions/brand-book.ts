"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, brands, brandBookDefaults, activity } from "@/lib/db";
import { requireBrandRole, requireUser } from "@/lib/auth";
import type { BookField } from "@/lib/brand-book";
import { bookPatch } from "@/server/brand-form";
import { getBookDefaults, linkBrandToBook, syncAllBrandBooks, syncBrandBook } from "@/server/brand-book";

/** Saves this person's master brand book and brings every linked brand along. */
export async function saveBookDefaultsAction(formData: FormData) {
  const user = await requireUser();
  const patch = { ...bookPatch(formData), updatedAt: new Date() };
  const existing = await getBookDefaults(user.id);
  const id = existing
    ? (await db.update(brandBookDefaults).set(patch).where(eq(brandBookDefaults.id, existing.id)).returning())[0].id
    : (await db.insert(brandBookDefaults).values({ ...patch, ownerId: user.id }).returning())[0].id;
  await syncAllBrandBooks(id);
  revalidatePath("/", "layout");
}

/** Points a brand at your master brand book. Empty fields fill in; written ones stay. */
export async function linkBrandBookAction(brandId: string) {
  const { user } = await requireBrandRole(brandId, "admin");
  const book = await getBookDefaults(user.id);
  if (!book) throw new Error("Write the master brand book first.");
  await linkBrandToBook(brandId, book.id);
  await db.insert(activity).values({
    brandId, actorId: user.id, action: "brand.linked_to_master_book", entity: "brand", entityId: brandId,
  });
  revalidatePath("/", "layout");
}

export async function unlinkBrandBookAction(brandId: string) {
  await requireBrandRole(brandId, "admin");
  await db.update(brands).set({ bookDefaultsId: null, bookSnapshot: {} }).where(eq(brands.id, brandId));
  revalidatePath("/", "layout");
}

export async function resolveBookFieldAction(brandId: string, field: BookField, choice: "accept" | "keep") {
  await requireBrandRole(brandId, "admin");
  await syncBrandBook(brandId, choice === "accept" ? { accept: [field] } : { keep: [field] });
  revalidatePath("/", "layout");
}
