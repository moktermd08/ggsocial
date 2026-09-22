"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, linkDestinations } from "@/lib/db";
import { can, getMyBrands, requireBrandRole, requireUser } from "@/lib/auth";
import { normalizeDestination } from "@/lib/links";
import { destColumns, type DestField, type DestValues } from "@/lib/destinations";
import {
  applyDestinationToLinks, createDestinationCopy, destinationAccess, syncAllDestinationCopies, syncDestinationCopy,
} from "@/server/destinations";

export type DestinationInput = {
  id?: string;
  /** New destinations only: null = a master destination. */
  brandId?: string | null;
  values: DestValues;
  notes: string | null;
  /** New master destinations only: brands to create a linked copy in. */
  copyBrandIds?: string[];
};

async function loadDestination(id: string) {
  const user = await requireUser();
  const row = await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, id) });
  if (!row) throw new Error("Destination not found.");
  const mine = await getMyBrands(user.id);
  const access = await destinationAccess(row, user.id, mine);
  if (!access.canView) throw new Error("Destination not found.");
  return { user, row, mine, access };
}

async function addCopies(masterId: string, brandIds: string[]) {
  const { user, row, mine } = await loadDestination(masterId);
  if (row.brandId) throw new Error("Only a master destination has brand copies.");
  const existing = await db.select({ brandId: linkDestinations.brandId }).from(linkDestinations)
    .where(and(eq(linkDestinations.masterId, masterId), isNull(linkDestinations.archivedAt)));
  const have = new Set(existing.map((e) => e.brandId));
  let created = 0;
  for (const brandId of brandIds) {
    const b = mine.find((x) => x.id === brandId);
    if (have.has(brandId) || !b || !can.edit(b.role)) continue;
    await createDestinationCopy(row, brandId, user.id);
    created++;
  }
  return created;
}

export async function saveDestinationAction(input: DestinationInput) {
  const user = await requireUser();
  const name = input.values.name.trim();
  if (!name) throw new Error("Give the destination a name.");
  const values = { ...input.values, name, url: normalizeDestination(input.values.url) };
  const columns = { ...destColumns(values), notes: input.notes?.trim() || null, updatedAt: new Date() };

  if (input.id) {
    const { row, access } = await loadDestination(input.id);
    if (!access.canEdit) throw new Error("You cannot change this destination.");
    await db.update(linkDestinations).set(columns).where(eq(linkDestinations.id, row.id));
    await applyDestinationToLinks(row.id);
    let synced = 0;
    if (row.masterId) await syncDestinationCopy(row.id);
    if (!row.brandId) synced = await syncAllDestinationCopies(row.id);
    revalidatePath("/", "layout");
    return { id: row.id, synced };
  }

  const brandId = input.brandId ?? null;
  if (brandId) await requireBrandRole(brandId, "editor");
  const [row] = await db.insert(linkDestinations).values({
    ...columns, name, url: values.url, brandId, ownerId: user.id,
  }).returning();
  if (!brandId && input.copyBrandIds?.length) await addCopies(row.id, input.copyBrandIds);
  revalidatePath("/", "layout");
  return { id: row.id, synced: 0 };
}

export async function addDestinationCopiesAction(masterId: string, brandIds: string[]) {
  const created = await addCopies(masterId, brandIds);
  revalidatePath("/", "layout");
  return { created };
}

export async function resolveDestinationFieldAction(id: string, field: DestField, choice: "accept" | "keep") {
  const { row, access } = await loadDestination(id);
  if (!row.masterId || !access.canEdit) throw new Error("You cannot change this destination.");
  await syncDestinationCopy(id, choice === "accept" ? { accept: [field] } : { keep: [field] });
  await applyDestinationToLinks(id);
  revalidatePath("/", "layout");
}

export async function unlinkDestinationAction(id: string) {
  const { row, access } = await loadDestination(id);
  if (!row.masterId || !access.canEdit) return;
  await db.update(linkDestinations).set({ masterId: null, masterSnapshot: {}, updatedAt: new Date() })
    .where(eq(linkDestinations.id, id));
  revalidatePath("/", "layout");
}

/** Archives it. Links already issued keep working and keep their current URL. */
export async function archiveDestinationAction(id: string) {
  const { row, access } = await loadDestination(id);
  if (!access.canEdit) throw new Error("You cannot archive this destination.");
  await db.update(linkDestinations).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(linkDestinations.id, id));
  if (!row.brandId) {
    await db.update(linkDestinations).set({ masterId: null, masterSnapshot: {} }).where(eq(linkDestinations.masterId, id));
  }
  revalidatePath("/", "layout");
  redirect("/links");
}
