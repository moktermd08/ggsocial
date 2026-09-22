"use server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, campaigns, campaignComments, activity, type CampaignStatus } from "@/lib/db";
import { can, getMyBrands, requireBrandRole, requireUser } from "@/lib/auth";
import { campaignColumns, type CampaignField, type CampaignValues } from "@/lib/campaigns";
import {
  campaignAccess, createCampaignCopy, renameCampaignLabel, syncAllCampaignCopies, syncCampaignCopy,
} from "@/server/campaigns";

export type CampaignInput = {
  id?: string;
  /** New campaigns only: null = a master campaign. */
  brandId?: string | null;
  values: CampaignValues;
  status: CampaignStatus;
  guidelines: string | null;
  notes: string | null;
  /** New master campaigns only: brands to create a linked copy in. */
  copyBrandIds?: string[];
};

async function loadCampaign(id: string) {
  const user = await requireUser();
  const row = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!row) throw new Error("Campaign not found.");
  const mine = await getMyBrands(user.id);
  const access = await campaignAccess(row, user.id, mine);
  if (!access.canView) throw new Error("Campaign not found.");
  return { user, row, mine, access };
}

/** Names are post labels, so two live campaigns in one place cannot share one. */
async function assertNameFree(name: string, brandId: string | null, ownerId: string, exceptId?: string) {
  const clash = await db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.name, name),
      isNull(campaigns.archivedAt),
      brandId ? eq(campaigns.brandId, brandId) : and(isNull(campaigns.brandId), eq(campaigns.ownerId, ownerId)),
      exceptId ? ne(campaigns.id, exceptId) : undefined,
    ),
  });
  if (clash) throw new Error(`There is already a campaign called "${name}" ${brandId ? "in this brand" : "in Master"}.`);
}

async function addCopies(masterId: string, brandIds: string[]) {
  const { user, row, mine } = await loadCampaign(masterId);
  if (row.brandId) throw new Error("Only a master campaign has brand copies.");
  const existing = await db.select({ brandId: campaigns.brandId }).from(campaigns).where(eq(campaigns.masterId, masterId));
  const have = new Set(existing.map((e) => e.brandId));
  let created = 0;
  for (const brandId of brandIds) {
    if (have.has(brandId)) continue;
    const b = mine.find((x) => x.id === brandId);
    if (!b || !can.edit(b.role)) continue;
    // A brand that already runs a campaign of this name keeps it; link it rather than duplicate.
    const same = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.brandId, brandId), eq(campaigns.name, row.name), isNull(campaigns.archivedAt)),
    });
    if (same) {
      await db.update(campaigns).set({ masterId, masterSnapshot: {} }).where(eq(campaigns.id, same.id));
      await syncCampaignCopy(same.id);
    } else {
      const copy = await createCampaignCopy(row, brandId, user.id);
      await db.insert(activity).values({
        brandId, actorId: user.id, action: "campaign.copied_from_master", entity: "campaign", entityId: copy.id,
      });
    }
    created++;
  }
  return created;
}

export async function saveCampaignAction(input: CampaignInput) {
  const user = await requireUser();
  const name = input.values.name.trim();
  if (!name) throw new Error("Give the campaign a name.");
  const values = { ...input.values, name };
  const own = {
    status: input.status,
    notes: input.notes?.trim() || null,
    updatedAt: new Date(),
  };

  if (input.id) {
    const { row, access } = await loadCampaign(input.id);
    if (!access.canEdit) {
      throw new Error(row.brandId
        ? "You need editor access on this brand."
        : "You need editor access on every brand this campaign reaches to change it.");
    }
    await assertNameFree(name, row.brandId, row.ownerId, row.id);
    await db.update(campaigns).set({
      ...campaignColumns(values), ...own,
      ...(row.brandId ? {} : { guidelines: input.guidelines?.trim() || null }),
    }).where(eq(campaigns.id, row.id));
    await renameCampaignLabel(row, row.name, name);

    let synced = 0;
    if (row.masterId) await syncCampaignCopy(row.id);
    if (!row.brandId) synced = await syncAllCampaignCopies(row.id);
    revalidatePath("/", "layout");
    return { id: row.id, synced };
  }

  const brandId = input.brandId ?? null;
  if (brandId) await requireBrandRole(brandId, "editor");
  await assertNameFree(name, brandId, user.id);
  const [row] = await db.insert(campaigns).values({
    ...campaignColumns(values), ...own, name,
    brandId, ownerId: user.id,
    guidelines: brandId ? null : input.guidelines?.trim() || null,
  }).returning();
  if (!brandId && input.copyBrandIds?.length) await addCopies(row.id, input.copyBrandIds);
  revalidatePath("/", "layout");
  return { id: row.id, synced: 0 };
}

export async function addCampaignCopiesAction(masterId: string, brandIds: string[]) {
  const created = await addCopies(masterId, brandIds);
  revalidatePath("/", "layout");
  return { created };
}

export async function resolveCampaignFieldAction(id: string, field: CampaignField, choice: "accept" | "keep") {
  const { row, access } = await loadCampaign(id);
  if (!row.masterId || !access.canEdit) throw new Error("You cannot change this campaign.");
  await syncCampaignCopy(id, choice === "accept" ? { accept: [field] } : { keep: [field] });
  revalidatePath("/", "layout");
}

export async function unlinkCampaignAction(id: string) {
  const { row, access } = await loadCampaign(id);
  if (!row.masterId || !access.canEdit) return;
  await db.update(campaigns).set({ masterId: null, masterSnapshot: {}, updatedAt: new Date() }).where(eq(campaigns.id, id));
  revalidatePath("/", "layout");
}

export async function addCampaignCommentAction(id: string, body: string) {
  const { user } = await loadCampaign(id);
  if (!body.trim()) return;
  await db.insert(campaignComments).values({ campaignId: id, userId: user.id, body: body.trim() });
  revalidatePath("/", "layout");
}

/**
 * Archives rather than deletes: posts still carry the name, and the numbers
 * belong to history. A master's copies stay with their brands, unlinked.
 */
export async function archiveCampaignAction(id: string) {
  const { row, access } = await loadCampaign(id);
  if (!access.canEdit) throw new Error("You cannot archive this campaign.");
  await db.update(campaigns).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(campaigns.id, id));
  if (!row.brandId) {
    await db.update(campaigns).set({ masterId: null, masterSnapshot: {} }).where(eq(campaigns.masterId, id));
  }
  revalidatePath("/", "layout");
  redirect("/campaigns");
}
