"use server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  db, masterPosts, masterPostComments, posts, postTargets, channels, attachments, activity,
} from "@/lib/db";
import { can, getMyBrands, requireBrandRole, requireUser } from "@/lib/auth";
import { isLockedStatus, toValues, type MasterField } from "@/lib/masters";
import { createCopy, masterAccess, syncAllCopies, syncCopy } from "@/server/masters";

export type MasterInput = {
  masterId?: string;
  title: string;
  body: string;
  campaign: string | null;
  tags: string[];
  scheduledAt: string | null;
  mediaIds: string[];
  platforms: string[];
  guidelines: string | null;
  notes: string | null;
  /** Brands to create a copy in. New masters only; later, use addMasterCopiesAction. */
  brandIds?: string[];
};

async function loadMaster(masterId: string) {
  const user = await requireUser();
  const master = await db.query.masterPosts.findFirst({ where: eq(masterPosts.id, masterId) });
  if (!master) throw new Error("Master post not found.");
  const mine = await getMyBrands(user.id);
  const copies = await db.select({ id: posts.id, brandId: posts.brandId, status: posts.status })
    .from(posts).where(eq(posts.masterPostId, masterId));
  const access = masterAccess(master, copies.map((c) => c.brandId), user.id, mine);
  if (!access.canView) throw new Error("Master post not found.");
  return { user, master, mine, copies, access };
}

/** Adds a copy to each brand that lacks one and that this person can write to. */
async function addCopies(masterId: string, brandIds: string[]) {
  const { user, master, mine, copies } = await loadMaster(masterId);
  const have = new Set(copies.map((c) => c.brandId));
  const created: string[] = [];
  for (const brandId of brandIds) {
    if (have.has(brandId)) continue;
    const b = mine.find((x) => x.id === brandId);
    if (!b || !can.edit(b.role)) continue;
    const row = await createCopy(master, brandId, user.id);
    created.push(row.id);
    await db.insert(activity).values({
      brandId, actorId: user.id, action: "post.copied_from_master", entity: "post", entityId: row.id,
      meta: { masterPostId: masterId },
    });
  }
  return created;
}

export async function saveMasterAction(input: MasterInput) {
  const user = await requireUser();
  const fields = {
    title: input.title.trim(),
    body: input.body,
    campaign: input.campaign?.trim() || null,
    tags: input.tags,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    mediaIds: input.mediaIds,
    platforms: input.platforms,
    guidelines: input.guidelines?.trim() || null,
    notes: input.notes?.trim() || null,
    updatedAt: new Date(),
  };

  if (input.masterId) {
    const { access } = await loadMaster(input.masterId);
    if (!access.canEdit) throw new Error("You need editor access on every brand this master reaches to change it.");
    await db.update(masterPosts).set(fields).where(eq(masterPosts.id, input.masterId));
    const synced = await syncAllCopies(input.masterId);
    revalidatePath("/", "layout");
    return { masterId: input.masterId, created: 0, synced };
  }

  const [row] = await db.insert(masterPosts).values({ ...fields, ownerId: user.id }).returning();
  const created = await addCopies(row.id, input.brandIds ?? []);
  revalidatePath("/", "layout");
  return { masterId: row.id, created: created.length, synced: 0 };
}

export async function addMasterCopiesAction(masterId: string, brandIds: string[]) {
  const created = await addCopies(masterId, brandIds);
  revalidatePath("/", "layout");
  return { created: created.length };
}

/** Takes a brand off a master. Only while its copy has not been signed off. */
export async function removeMasterCopyAction(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post?.masterPostId) throw new Error("Not a master copy.");
  await requireBrandRole(post.brandId, "editor");
  if (isLockedStatus(post.status)) {
    throw new Error("This copy is approved or out already. Unlink it from the master instead.");
  }
  await db.delete(posts).where(eq(posts.id, postId));
  revalidatePath("/", "layout");
}

/** Keeps the post as it is but stops it following the master. */
export async function unlinkCopyAction(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post?.masterPostId) return;
  const { user } = await requireBrandRole(post.brandId, "editor");
  await db.update(posts).set({ masterPostId: null, masterSnapshot: {}, updatedAt: new Date() })
    .where(eq(posts.id, postId));
  await db.insert(activity).values({
    brandId: post.brandId, actorId: user.id, action: "post.unlinked_from_master", entity: "post", entityId: postId,
    meta: { masterPostId: post.masterPostId },
  });
  revalidatePath("/", "layout");
}

/** Take the master's version of one field, or keep this brand's. */
export async function resolveCopyFieldAction(postId: string, field: MasterField, choice: "accept" | "keep") {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post?.masterPostId) throw new Error("Not a master copy.");
  await requireBrandRole(post.brandId, "editor");
  await syncCopy(postId, choice === "accept" ? { accept: [field] } : { keep: [field] });
  revalidatePath("/", "layout");
}

export async function addMasterCommentAction(masterId: string, body: string) {
  const { user } = await loadMaster(masterId);
  if (!body.trim()) return;
  await db.insert(masterPostComments).values({ masterPostId: masterId, userId: user.id, body: body.trim() });
  revalidatePath("/", "layout");
}

/** Deletes the master only. Its copies stay, as ordinary posts in each brand. */
export async function deleteMasterAction(masterId: string) {
  const { access } = await loadMaster(masterId);
  if (!access.canEdit) throw new Error("You need editor access on every brand this master reaches to delete it.");
  await db.update(posts).set({ masterSnapshot: {} }).where(eq(posts.masterPostId, masterId));
  await db.delete(masterPosts).where(eq(masterPosts.id, masterId));
  revalidatePath("/", "layout");
  redirect("/posts");
}

/**
 * Turns an existing post into a master, with this post as its first copy, so
 * it can then be carried into the other brands.
 */
export async function promoteToMasterAction(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) throw new Error("Post not found.");
  if (post.masterPostId) redirect(`/posts/master/${post.masterPostId}`);
  const { user } = await requireBrandRole(post.brandId, "editor");

  const atts = await db.select().from(attachments)
    .where(and(eq(attachments.postId, postId), isNull(attachments.targetId)))
    .orderBy(asc(attachments.position));
  const platforms = await db.selectDistinct({ platform: channels.platform })
    .from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(eq(postTargets.postId, postId));

  const mediaIds = atts.map((a) => a.mediaId);
  const [master] = await db.insert(masterPosts).values({
    ownerId: user.id,
    title: post.title,
    body: post.body,
    campaign: post.campaign,
    tags: post.tags,
    scheduledAt: post.scheduledAt,
    mediaIds,
    platforms: platforms.map((p) => p.platform),
    notes: post.notes,
  }).returning();

  await db.update(posts).set({
    masterPostId: master.id,
    masterSnapshot: toValues({ ...post, mediaIds }),
    updatedAt: new Date(),
  }).where(eq(posts.id, postId));

  revalidatePath("/", "layout");
  redirect(`/posts/master/${master.id}`);
}
