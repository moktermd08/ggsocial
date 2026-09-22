"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, contentIdeas, ideaVersions, posts, activity, brands, type IdeaStatus } from "@/lib/db";
import { ideaColumns, ideaValues, type IdeaField, type IdeaValues } from "@/lib/ideas";
import { ideaAccess, ideaForBrand, syncIdeaVersion, syncIdeaVersions } from "@/server/ideas";
import { requireUser, requireBrandRole, getMembership, can } from "@/lib/auth";

export type IdeaInput = {
  ideaId?: string;
  problem: string;
  action?: string | null;
  outcome?: string | null;
  title?: string;
  pillar?: string | null;
  series?: string | null;
  postType?: string | null;
  tone?: string | null;
  needsMedia?: boolean;
  hashtags?: string[];
  status?: IdeaStatus;
  targetImpressions?: number | null;
  notes?: string | null;
  keyLearning?: string | null;
};

/**
 * Throws unless the idea is in this person's shared plan. "edit" is for the
 * idea itself (its author and fellow admins); "view" is enough to fan it out
 * or adapt it for a brand, where brand roles are checked separately.
 */
async function requireIdea(ideaId: string, need: "view" | "edit") {
  const user = await requireUser();
  const idea = await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, ideaId) });
  if (!idea) throw new Error("Idea not found.");
  const access = await ideaAccess(user.id, idea.ownerId);
  if (!(need === "edit" ? access.canEdit : access.canView)) {
    throw new Error(need === "edit" ? "Only the idea's author or a fellow admin can change it." : "Idea not found.");
  }
  return { user, idea };
}

export async function saveIdeaAction(input: IdeaInput) {
  const user = await requireUser();
  const problem = input.problem.trim();
  if (!problem) throw new Error("An idea needs at least the problem line.");

  const fields = {
    problem,
    action: input.action?.trim() || null,
    outcome: input.outcome?.trim() || null,
    title: input.title?.trim() ?? "",
    pillar: input.pillar?.trim() || null,
    series: input.series?.trim() || null,
    postType: input.postType?.trim() || null,
    tone: input.tone?.trim() || null,
    needsMedia: input.needsMedia ?? false,
    hashtags: input.hashtags ?? [],
    status: input.status ?? ("backlog" as IdeaStatus),
    targetImpressions: input.targetImpressions ?? null,
    notes: input.notes?.trim() || null,
    keyLearning: input.keyLearning?.trim() || null,
    updatedAt: new Date(),
  };

  let ideaId = input.ideaId;
  if (ideaId) {
    await requireIdea(ideaId, "edit");
    await db.update(contentIdeas).set(fields).where(eq(contentIdeas.id, ideaId));
    // Brand versions pick up changes to whatever they have not adapted.
    await syncIdeaVersions(ideaId);
  } else {
    // New ideas land at the bottom of the plan rather than renumbering it.
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${contentIdeas.sequence}), 0)::int + 1` })
      .from(contentIdeas).where(eq(contentIdeas.ownerId, user.id));
    const [row] = await db.insert(contentIdeas)
      .values({ ...fields, ownerId: user.id, sequence: next })
      .returning({ id: contentIdeas.id });
    ideaId = row.id;
  }

  revalidatePath("/ideas");
  return { ideaId };
}

export async function archiveIdeaAction(ideaId: string) {
  await requireIdea(ideaId, "edit");
  await db.update(contentIdeas).set({ archivedAt: new Date() }).where(eq(contentIdeas.id, ideaId));
  revalidatePath("/ideas");
}

/**
 * The starter draft for one brand's take on an idea.
 *
 * This is a skeleton, not finished copy: the three beats in order, then the
 * brand's own CTA and hashtags. The writer (or, later, a drafting model with
 * the brand book in hand) rewrites it in that brand's voice.
 */
function scaffold(idea: typeof contentIdeas.$inferSelect, brand: typeof brands.$inferSelect) {
  const beats = [idea.problem, idea.action, idea.outcome].filter(Boolean) as string[];
  const tail = [brand.ctaText?.trim(), brand.defaultHashtags.join(" ").trim()].filter(Boolean);
  return [...beats, ...tail].join("\n\n");
}

/**
 * Creates one draft post per brand for an idea — the same insight told four
 * ways. Brands that already carry this idea are left alone, so running it
 * again after adding a brand only fills the gap.
 *
 * Channels are deliberately not pre-selected: which accounts a post goes to is
 * a decision per post, and the composer is one click away.
 */
export async function fanOutIdeaAction(ideaId: string, brandIds: string[]) {
  const { user, idea } = await requireIdea(ideaId, "view");
  if (brandIds.length === 0) throw new Error("Pick at least one brand.");

  const brandRows = await db.select().from(brands).where(inArray(brands.id, brandIds));
  const existing = await db.select({ brandId: posts.brandId }).from(posts)
    .where(and(eq(posts.ideaId, ideaId), inArray(posts.brandId, brandIds)));
  const already = new Set(existing.map((e) => e.brandId));

  const created: string[] = [];
  const skipped: string[] = [];
  for (const brand of brandRows) {
    if (already.has(brand.id)) { skipped.push(brand.name); continue; }
    const membership = await getMembership(user.id, brand.id);
    if (!membership || !can.edit(membership.role)) { skipped.push(brand.name); continue; }
    // Each brand's draft starts from its own version of the idea; a brand
    // that sits this one out gets no draft.
    const told = await ideaForBrand(idea.id, brand.id);
    if (!told || told.skipped) { skipped.push(brand.name); continue; }
    const mine = told.idea;

    const [row] = await db.insert(posts).values({
      brandId: brand.id,
      ideaId: idea.id,
      title: mine.title || mine.problem,
      body: scaffold(mine, brand),
      status: "draft",
      postType: mine.postType,
      tone: mine.tone,
      targetImpressions: mine.targetImpressions,
      createdBy: user.id,
    }).returning({ id: posts.id });
    created.push(row.id);

    await db.insert(activity).values({
      brandId: brand.id, actorId: user.id, action: "fanned_out", entity: "post", entityId: row.id,
      meta: { ideaId: idea.id },
    });
  }

  // An idea with drafts against it is no longer sitting in the backlog.
  if (created.length && idea.status === "backlog") {
    await db.update(contentIdeas).set({ status: "drafting", updatedAt: new Date() })
      .where(eq(contentIdeas.id, idea.id));
  }

  revalidatePath("/ideas");
  revalidatePath("/posts");
  // Ids, not just a count: the board drafts each one next, one request apiece.
  return { created: created.length, createdPostIds: created, skipped };
}

/** The per-post plan fields the grid reports on but the composer does not own. */
export async function updatePostPlanAction(input: {
  postId: string;
  targetImpressions?: number | null;
  keyLearning?: string | null;
  notes?: string | null;
  repliedAt?: string | null;
}) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, input.postId) });
  if (!post) throw new Error("Post not found.");
  const { role } = await requireBrandRole(post.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to change the plan.");

  await db.update(posts).set({
    targetImpressions: input.targetImpressions ?? null,
    keyLearning: input.keyLearning?.trim() || null,
    notes: input.notes?.trim() || null,
    repliedAt: input.repliedAt ? new Date(input.repliedAt) : null,
    updatedAt: new Date(),
  }).where(eq(posts.id, input.postId));

  revalidatePath("/ideas");
  revalidatePath(`/posts/${input.postId}`);
}

/* ------------------------------------------------------- brand versions */

/**
 * Saves one brand's version of an idea, creating it on first change. Only the
 * fields passed are written; everything else keeps following the idea.
 */
export async function saveIdeaVersionAction(input: {
  ideaId: string;
  brandId: string;
  values?: Partial<IdeaValues>;
  angle?: string | null;
  notes?: string | null;
  skipped?: boolean;
}) {
  const { idea } = await requireIdea(input.ideaId, "view");
  await requireBrandRole(input.brandId, "editor");

  let version = await db.query.ideaVersions.findFirst({
    where: and(eq(ideaVersions.ideaId, idea.id), eq(ideaVersions.brandId, input.brandId)),
  });
  if (!version) {
    const base = ideaValues(idea);
    [version] = await db.insert(ideaVersions).values({
      ideaId: idea.id, brandId: input.brandId, masterSnapshot: base,
      ...ideaColumns(base), problem: idea.problem,
    }).returning();
  }

  const values = input.values ?? {};
  if (values.problem !== undefined && !values.problem.trim()) throw new Error("The problem line cannot be empty.");
  await db.update(ideaVersions).set({
    ...ideaColumns(values),
    ...(input.angle !== undefined ? { angle: input.angle?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
    updatedAt: new Date(),
  }).where(eq(ideaVersions.id, version.id));
  await syncIdeaVersion(version.id);
  revalidatePath("/ideas");
}

async function requireOwnVersion(versionId: string) {
  const version = await db.query.ideaVersions.findFirst({ where: eq(ideaVersions.id, versionId) });
  if (!version) throw new Error("That version no longer exists.");
  await requireIdea(version.ideaId, "view");
  await requireBrandRole(version.brandId, "editor");
  return version;
}

export async function resolveIdeaFieldAction(versionId: string, field: IdeaField, choice: "accept" | "keep") {
  await requireOwnVersion(versionId);
  await syncIdeaVersion(versionId, choice === "accept" ? { accept: [field] } : { keep: [field] });
  revalidatePath("/ideas");
}

/** Drops the brand's version: it tells the idea exactly as written again. */
export async function resetIdeaVersionAction(versionId: string) {
  await requireOwnVersion(versionId);
  await db.delete(ideaVersions).where(eq(ideaVersions.id, versionId));
  revalidatePath("/ideas");
}
