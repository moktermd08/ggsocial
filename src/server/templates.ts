import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db, postTemplates } from "@/lib/db";
import { can, type BrandWithRole } from "@/lib/auth";
import { inheritState, planSync } from "@/lib/masters";
import {
  TEMPLATE_FIELDS, templateColumns, templateValues, type TemplateField, type TemplateOption,
} from "@/lib/templates";
import { masterAccess } from "@/server/masters";

export type TemplateRow = typeof postTemplates.$inferSelect;

export function templateState(copy: TemplateRow, master: TemplateRow) {
  return inheritState(TEMPLATE_FIELDS, templateValues(copy), copy.masterSnapshot, templateValues(master));
}

export async function templateAccess(t: TemplateRow, userId: string, mine: BrandWithRole[]) {
  if (t.brandId) {
    const b = mine.find((x) => x.id === t.brandId);
    return { canView: Boolean(b), canEdit: b ? can.edit(b.role) : false };
  }
  const copies = await db.select({ brandId: postTemplates.brandId }).from(postTemplates)
    .where(and(eq(postTemplates.masterId, t.id), isNull(postTemplates.archivedAt)));
  return masterAccess(t, copies.map((c) => c.brandId!), userId, mine);
}

export type TemplateSummary = TemplateRow & {
  copies: ({ id: string; brandId: string } & ReturnType<typeof templateState>)[];
  pending: TemplateField[];
};

async function summarise(rows: TemplateRow[]): Promise<TemplateSummary[]> {
  if (rows.length === 0) return [];
  const masterIds = rows.filter((r) => !r.brandId).map((r) => r.id);
  const linked = rows.map((r) => r.masterId).filter((x): x is string => Boolean(x));
  const [copies, masters] = await Promise.all([
    masterIds.length
      ? db.select().from(postTemplates).where(and(inArray(postTemplates.masterId, masterIds), isNull(postTemplates.archivedAt)))
      : [],
    linked.length ? db.select().from(postTemplates).where(inArray(postTemplates.id, linked)) : [],
  ]);
  const masterById = new Map(masters.map((m) => [m.id, m]));
  return rows.map((r) => {
    const master = r.masterId ? masterById.get(r.masterId) : undefined;
    return {
      ...r,
      copies: copies.filter((c) => c.masterId === r.id).map((c) => ({ id: c.id, brandId: c.brandId!, ...templateState(c, r) })),
      pending: master ? templateState(r, master).pending : [],
    };
  });
}

export async function listMasterTemplates(userId: string, brandIds: string[]) {
  const reaching = brandIds.length
    ? await db.selectDistinct({ id: postTemplates.masterId }).from(postTemplates)
        .where(and(inArray(postTemplates.brandId, brandIds), isNotNull(postTemplates.masterId)))
    : [];
  const ids = reaching.map((r) => r.id!).filter(Boolean);
  const visible = ids.length ? or(eq(postTemplates.ownerId, userId), inArray(postTemplates.id, ids)) : eq(postTemplates.ownerId, userId);
  const rows = await db.select().from(postTemplates)
    .where(and(isNull(postTemplates.brandId), isNull(postTemplates.archivedAt), visible))
    .orderBy(asc(postTemplates.name));
  return summarise(rows);
}

export async function listBrandTemplates(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  const rows = await db.select().from(postTemplates)
    .where(and(inArray(postTemplates.brandId, brandIds), isNull(postTemplates.archivedAt)))
    .orderBy(asc(postTemplates.name));
  return summarise(rows);
}

export async function getTemplate(id: string) {
  const row = await db.query.postTemplates.findFirst({ where: eq(postTemplates.id, id) });
  if (!row) return null;
  const [summary] = await summarise([row]);
  const master = row.masterId ? await db.query.postTemplates.findFirst({ where: eq(postTemplates.id, row.masterId) }) ?? null : null;
  return { ...summary, master, state: master ? templateState(row, master) : null };
}

function option(t: TemplateRow, fromMaster: boolean): TemplateOption {
  return {
    id: t.id, name: t.name, description: t.description, title: t.title, body: t.body, postType: t.postType,
    platforms: t.platforms, hashtags: t.hashtags, firstComment: t.firstComment, fromMaster,
  };
}

/**
 * What the composer offers, per brand: the brand's own templates and copies,
 * then any master template it has no copy of yet — so a new master template
 * is usable everywhere straight away.
 */
export async function templateOptionsByBrand(userId: string, brandIds: string[]) {
  const [brandRows, masters] = await Promise.all([listBrandTemplates(brandIds), listMasterTemplates(userId, brandIds)]);
  const out: Record<string, TemplateOption[]> = {};
  for (const brandId of brandIds) {
    const own = brandRows.filter((t) => t.brandId === brandId);
    const copied = new Set(own.map((t) => t.masterId).filter(Boolean));
    out[brandId] = [
      ...own.map((t) => option(t, false)),
      ...masters.filter((m) => !copied.has(m.id)).map((m) => option(m, true)),
    ];
  }
  return out;
}

export async function masterTemplateOptions(userId: string, brandIds: string[]) {
  return (await listMasterTemplates(userId, brandIds)).map((m) => option(m, true));
}

/* ------------------------------------------------------------------ writing */

export async function syncTemplateCopy(id: string, opts: { accept?: TemplateField[]; keep?: TemplateField[] } = {}) {
  const row = await db.query.postTemplates.findFirst({ where: eq(postTemplates.id, id) });
  if (!row?.masterId) return;
  const master = await db.query.postTemplates.findFirst({ where: eq(postTemplates.id, row.masterId) });
  if (!master) return;
  const { next, snapshot } = planSync(TEMPLATE_FIELDS, templateValues(row), row.masterSnapshot, templateValues(master), opts);
  const changed = Object.keys(next).length > 0;
  await db.update(postTemplates)
    .set({ ...templateColumns(next), masterSnapshot: snapshot, ...(changed ? { updatedAt: new Date() } : {}) })
    .where(eq(postTemplates.id, id));
}

export async function syncAllTemplateCopies(masterId: string) {
  const copies = await db.select({ id: postTemplates.id }).from(postTemplates).where(eq(postTemplates.masterId, masterId));
  for (const c of copies) await syncTemplateCopy(c.id);
  return copies.length;
}

export async function createTemplateCopy(master: TemplateRow, brandId: string, userId: string) {
  const values = templateValues(master);
  const [row] = await db.insert(postTemplates).values({
    ...templateColumns(values), name: master.name,
    brandId, ownerId: userId, masterId: master.id, masterSnapshot: { ...values },
  }).returning();
  return row;
}
