import "server-only";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, brands, contentIdeas, ideaVersions, memberships, posts } from "@/lib/db";
import { masterOwnersFor } from "@/server/media-library";
import { inheritState, planSync } from "@/lib/masters";
import { ideaAudience, ideaIsFor } from "@/lib/idea-scope";
import { IDEA_FIELDS, ideaColumns, ideaValues, type IdeaField, type IdeaVersionView } from "@/lib/ideas";

/** Every brand version of these ideas in these brands, keyed "ideaId:brandId". */
export async function ideaVersionViews(ideas: (typeof contentIdeas.$inferSelect)[], brandIds: string[]) {
  const out = new Map<string, IdeaVersionView>();
  if (ideas.length === 0 || brandIds.length === 0) return out;
  const rows = await db.select().from(ideaVersions)
    .where(and(inArray(ideaVersions.ideaId, ideas.map((i) => i.id)), inArray(ideaVersions.brandId, brandIds)));
  const ideaById = new Map(ideas.map((i) => [i.id, i]));
  for (const v of rows) {
    const idea = ideaById.get(v.ideaId);
    if (!idea) continue;
    const values = ideaValues(v);
    out.set(`${v.ideaId}:${v.brandId}`, {
      id: v.id, values, angle: v.angle, notes: v.notes, skipped: v.skipped,
      ...inheritState(IDEA_FIELDS, values, v.masterSnapshot, ideaValues(idea)),
    });
  }
  return out;
}

/** Brings one brand version up to date with its idea. Never locked: it is a plan, not a post. */
export async function syncIdeaVersion(versionId: string, opts: { accept?: IdeaField[]; keep?: IdeaField[] } = {}) {
  const v = await db.query.ideaVersions.findFirst({ where: eq(ideaVersions.id, versionId) });
  if (!v) return;
  const idea = await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, v.ideaId) });
  if (!idea) return;
  const { next, snapshot } = planSync(IDEA_FIELDS, ideaValues(v), v.masterSnapshot, ideaValues(idea), opts);
  await db.update(ideaVersions)
    .set({ ...ideaColumns(next), masterSnapshot: snapshot, ...(Object.keys(next).length ? { updatedAt: new Date() } : {}) })
    .where(eq(ideaVersions.id, versionId));
}

export async function syncIdeaVersions(ideaId: string) {
  const rows = await db.select({ id: ideaVersions.id }).from(ideaVersions).where(eq(ideaVersions.ideaId, ideaId));
  for (const r of rows) await syncIdeaVersion(r.id);
}

/**
 * The idea as one brand tells it: its version's fields laid over the idea,
 * with the brand's angle and notes folded into the planning notes that
 * drafting and fan-out already read. No version = the idea as written.
 */
export async function ideaForBrand(ideaId: string, brandId: string) {
  const idea = await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, ideaId) });
  if (!idea) return null;
  // An idea aimed at other brands is sat out here, whatever versions exist.
  if (!ideaIsFor(idea, brandId)) return { idea, skipped: true };
  const v = await db.query.ideaVersions.findFirst({
    where: and(eq(ideaVersions.ideaId, ideaId), eq(ideaVersions.brandId, brandId)),
  });
  if (!v) return { idea, skipped: false };
  const notes = [
    idea.notes,
    v.angle ? `This brand's angle: ${v.angle}` : null,
    v.notes ? `Notes for this brand: ${v.notes}` : null,
  ].filter(Boolean).join("\n") || null;
  return {
    idea: {
      ...idea,
      title: v.title, problem: v.problem, action: v.action, outcome: v.outcome,
      postType: v.postType, tone: v.tone, hashtags: v.hashtags, targetImpressions: v.targetImpressions, notes,
    },
    skipped: v.skipped,
  };
}

/** SQL: ideas this brand may tell — open to every brand, or aimed at this one. */
export function ideaVisibleToBrand(brandId: string) {
  return or(isNull(contentIdeas.brandIds), sql`${contentIdeas.brandIds} @> ${JSON.stringify([brandId])}::jsonb`);
}

/** The brands an idea reaches: the ones it is aimed at, or every brand its author runs. */
export async function audienceOf(idea: typeof contentIdeas.$inferSelect) {
  const mine = await db.select({ brandId: memberships.brandId }).from(memberships)
    .innerJoin(brands, eq(brands.id, memberships.brandId))
    .where(and(eq(memberships.userId, idea.ownerId), inArray(memberships.role, ["owner", "admin"]), isNull(brands.archivedAt)));
  return ideaAudience(idea, mine.map((m) => m.brandId));
}

/**
 * Who can see and change an idea. The plan is shared the way the master
 * library is: an idea is visible to everyone on a brand its author admins,
 * and the author's fellow admins can edit it as well as the author. Brand
 * editors adapt their own brand's version and fan out into their brands, but
 * leave the idea itself alone.
 */
export async function ideaAccess(userId: string, ownerId: string) {
  if (ownerId === userId) return { canView: true, canEdit: true };
  const [theirs, mine] = await Promise.all([
    db.select({ brandId: memberships.brandId, role: memberships.role }).from(memberships).where(eq(memberships.userId, ownerId)),
    db.select({ brandId: memberships.brandId, role: memberships.role }).from(memberships).where(eq(memberships.userId, userId)),
  ]);
  const adminOf = new Set(theirs.filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.brandId));
  const shared = mine.filter((m) => adminOf.has(m.brandId));
  return {
    canView: shared.length > 0,
    canEdit: shared.some((m) => m.role === "owner" || m.role === "admin"),
  };
}

/** Whose plans a person sees: their own, and those of anyone who admins a brand they are on. */
export async function planOwnersFor(userId: string, brandIds: string[]) {
  return masterOwnersFor(userId, brandIds);
}

/**
 * Ideas in the plan that some of these brands have not told yet and have not
 * skipped: the work still to be put on the calendar, planned ones first, in
 * plan order.
 */
export async function unbookedIdeas(userId: string, myBrandIds: string[], scopeBrandIds: string[], limit = 12) {
  if (scopeBrandIds.length === 0) return [];
  const owners = await planOwnersFor(userId, myBrandIds);
  if (owners.length === 0) return [];
  const ideas = await db.select().from(contentIdeas).where(and(
    inArray(contentIdeas.ownerId, owners), isNull(contentIdeas.archivedAt),
    inArray(contentIdeas.status, ["backlog", "planned", "drafting"]),
  )).orderBy(asc(contentIdeas.sequence));
  if (ideas.length === 0) return [];

  const ids = ideas.map((i) => i.id);
  const [told, skipped, brandRows] = await Promise.all([
    db.select({ ideaId: posts.ideaId, brandId: posts.brandId }).from(posts)
      .where(and(inArray(posts.ideaId, ids), inArray(posts.brandId, scopeBrandIds), ne(posts.status, "failed"))),
    db.select({ ideaId: ideaVersions.ideaId, brandId: ideaVersions.brandId }).from(ideaVersions)
      .where(and(inArray(ideaVersions.ideaId, ids), inArray(ideaVersions.brandId, scopeBrandIds), eq(ideaVersions.skipped, true))),
    db.select({ id: brands.id, name: brands.name, color: brands.color }).from(brands)
      .where(and(inArray(brands.id, scopeBrandIds), isNull(brands.archivedAt))),
  ]);
  const done = new Set([...told, ...skipped].map((r) => `${r.ideaId}:${r.brandId}`));

  return ideas
    .map((idea) => ({ idea, missing: brandRows.filter((b) => ideaIsFor(idea, b.id) && !done.has(`${idea.id}:${b.id}`)) }))
    .filter((r) => r.missing.length > 0)
    .sort((a, b) => Number(b.idea.status === "planned") - Number(a.idea.status === "planned") || a.idea.sequence - b.idea.sequence)
    .slice(0, limit);
}
