"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, contentIdeas, posts, activity, brands, type IdeaStatus } from "@/lib/db";
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

/** Throws unless the idea exists and belongs to the signed-in user. */
async function requireOwnIdea(ideaId: string) {
  const user = await requireUser();
  const idea = await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, ideaId) });
  if (!idea || idea.ownerId !== user.id) throw new Error("That idea is not yours to change.");
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
    await requireOwnIdea(ideaId);
    await db.update(contentIdeas).set(fields).where(eq(contentIdeas.id, ideaId));
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
  await requireOwnIdea(ideaId);
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
  const { user, idea } = await requireOwnIdea(ideaId);
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

    const [row] = await db.insert(posts).values({
      brandId: brand.id,
      ideaId: idea.id,
      title: idea.title || idea.problem,
      body: scaffold(idea, brand),
      status: "draft",
      postType: idea.postType,
      tone: idea.tone,
      targetImpressions: idea.targetImpressions,
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
