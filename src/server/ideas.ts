import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, contentIdeas, ideaVersions } from "@/lib/db";
import { inheritState, planSync } from "@/lib/masters";
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
