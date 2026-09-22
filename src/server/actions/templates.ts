"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { redirect } from "next/navigation";
import { db, postTemplates } from "@/lib/db";
import { can, getMyBrands, requireBrandRole, requireUser } from "@/lib/auth";
import { templateColumns, type TemplateField, type TemplateValues } from "@/lib/templates";
import {
  createTemplateCopy, syncAllTemplateCopies, syncTemplateCopy, templateAccess,
} from "@/server/templates";

export type TemplateInput = {
  id?: string;
  /** New templates only: null = a master template. */
  brandId?: string | null;
  values: TemplateValues;
  notes: string | null;
  /** New master templates only: brands to create a linked copy in. */
  copyBrandIds?: string[];
};

async function loadTemplate(id: string) {
  const user = await requireUser();
  const row = await db.query.postTemplates.findFirst({ where: eq(postTemplates.id, id) });
  if (!row) throw new Error("Template not found.");
  const mine = await getMyBrands(user.id);
  const access = await templateAccess(row, user.id, mine);
  if (!access.canView) throw new Error("Template not found.");
  return { user, row, mine, access };
}

async function addCopies(masterId: string, brandIds: string[]) {
  const { user, row, mine } = await loadTemplate(masterId);
  if (row.brandId) throw new Error("Only a master template has brand copies.");
  const existing = await db.select({ brandId: postTemplates.brandId }).from(postTemplates)
    .where(and(eq(postTemplates.masterId, masterId), isNull(postTemplates.archivedAt)));
  const have = new Set(existing.map((e) => e.brandId));
  let created = 0;
  for (const brandId of brandIds) {
    const b = mine.find((x) => x.id === brandId);
    if (have.has(brandId) || !b || !can.edit(b.role)) continue;
    await createTemplateCopy(row, brandId, user.id);
    created++;
  }
  return created;
}

export async function saveTemplateAction(input: TemplateInput) {
  return asResult(async () => {
    const user = await requireUser();
    const name = input.values.name.trim();
    if (!name) throw new Error("Give the template a name.");
    const columns = { ...templateColumns({ ...input.values, name }), notes: input.notes?.trim() || null, updatedAt: new Date() };

    if (input.id) {
      const { row, access } = await loadTemplate(input.id);
      if (!access.canEdit) {
        throw new Error(row.brandId
          ? "You need editor access on this brand."
          : "You need editor access on every brand this template reaches to change it.");
      }
      await db.update(postTemplates).set(columns).where(eq(postTemplates.id, row.id));
      let synced = 0;
      if (row.masterId) await syncTemplateCopy(row.id);
      if (!row.brandId) synced = await syncAllTemplateCopies(row.id);
      revalidatePath("/", "layout");
      return { id: row.id, synced };
    }

    const brandId = input.brandId ?? null;
    if (brandId) await requireBrandRole(brandId, "editor");
    const [row] = await db.insert(postTemplates).values({ ...columns, name, brandId, ownerId: user.id }).returning();
    if (!brandId && input.copyBrandIds?.length) await addCopies(row.id, input.copyBrandIds);
    revalidatePath("/", "layout");
    return { id: row.id, synced: 0 };
  });
}

export async function addTemplateCopiesAction(masterId: string, brandIds: string[]) {
  return asResult(async () => {
    const created = await addCopies(masterId, brandIds);
    revalidatePath("/", "layout");
    return { created };
  });
}

export async function resolveTemplateFieldAction(id: string, field: TemplateField, choice: "accept" | "keep") {
  return asResult(async () => {
    const { row, access } = await loadTemplate(id);
    if (!row.masterId || !access.canEdit) throw new Error("You cannot change this template.");
    await syncTemplateCopy(id, choice === "accept" ? { accept: [field] } : { keep: [field] });
    revalidatePath("/", "layout");
  });
}

export async function unlinkTemplateAction(id: string) {
  return asResult(async () => {
    const { row, access } = await loadTemplate(id);
    if (!row.masterId || !access.canEdit) return;
    await db.update(postTemplates).set({ masterId: null, masterSnapshot: {}, updatedAt: new Date() }).where(eq(postTemplates.id, id));
    revalidatePath("/", "layout");
  });
}

/** Archives the template. A master's copies stay with their brands, unlinked. */
export async function archiveTemplateAction(id: string) {
  return asResult(async () => {
    const { row, access } = await loadTemplate(id);
    if (!access.canEdit) throw new Error("You cannot archive this template.");
    await db.update(postTemplates).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(postTemplates.id, id));
    if (!row.brandId) {
      await db.update(postTemplates).set({ masterId: null, masterSnapshot: {} }).where(eq(postTemplates.masterId, id));
    }
    revalidatePath("/", "layout");
    redirect("/templates");
  });
}
