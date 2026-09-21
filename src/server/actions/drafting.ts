"use server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, brands, channels, contentIdeas, links, posts, postTargets, activity } from "@/lib/db";
import { requireBrandRole, can } from "@/lib/auth";
import { platformOrNull } from "@/lib/platforms";
import { shortUrl } from "@/lib/links";
import { draftPost, draftingConfigured, DraftingError, NOT_CONFIGURED, type DraftChannel, type Draft } from "@/server/drafting";

export type DraftResponse =
  | { ok: true; draft: Draft; issues: string[] }
  | { ok: false; error: string };

/**
 * Asked before a bulk fan-out, so a missing key stops the run before any lane
 * posts exist — otherwise they would be created empty and stranded there.
 */
export async function draftingStatusAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  return draftingConfigured() ? { ok: true } : { ok: false, error: NOT_CONFIGURED };
}

/** The tracked link per channel for a post, newest first, so drafts carry it. */
async function linksFor(postId: string | null | undefined) {
  if (!postId) return new Map<string, string>();
  const rows = await db.select({ channelId: links.channelId, code: links.code }).from(links)
    .where(and(eq(links.postId, postId), isNull(links.archivedAt)))
    .orderBy(desc(links.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (r.channelId && !out.has(r.channelId)) out.set(r.channelId, shortUrl(r.code));
  return out;
}

async function loadChannels(brandId: string, channelIds: string[], postId?: string | null): Promise<DraftChannel[]> {
  if (channelIds.length === 0) return [];
  const rows = await db.select().from(channels)
    .where(and(inArray(channels.id, channelIds), eq(channels.brandId, brandId)));
  const linkMap = await linksFor(postId);
  return rows.map((c) => ({ id: c.id, platform: c.platform, handle: c.handle, link: linkMap.get(c.id) ?? null }));
}

/** Failures come back as values, so the UI can show them next to the button. */
async function guarded(work: () => Promise<DraftResponse>): Promise<DraftResponse> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof DraftingError) return { ok: false, error: err.message };
    console.error("[drafting] unexpected failure", err);
    return { ok: false, error: "Drafting failed unexpectedly. Check the server logs." };
  }
}

async function logUsage(brandId: string, userId: string, postId: string | null, usage: { input: number; output: number; cacheRead: number; cacheWrite: number; model: string }) {
  // Kept in the activity log so drafting spend can be totted up per brand.
  await db.insert(activity).values({
    brandId, actorId: userId, action: "post.drafted", entity: "post", entityId: postId, meta: usage,
  });
}

/**
 * A draft for the composer. Returned, never saved: the writer sees it in the
 * editor and decides what to keep, so nothing they typed is lost.
 */
export async function generateDraftAction(input: {
  brandId: string;
  postId?: string | null;
  ideaId?: string | null;
  title: string;
  body: string;
  channelIds: string[];
}): Promise<DraftResponse> {
  return guarded(async () => {
    const { user, role } = await requireBrandRole(input.brandId, "editor");
    if (!can.edit(role)) return { ok: false, error: "You need editor access to draft posts." };

    const brand = await db.query.brands.findFirst({ where: eq(brands.id, input.brandId) });
    if (!brand) return { ok: false, error: "Brand not found." };

    const idea = input.ideaId
      ? (await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, input.ideaId) })) ?? null
      : null;

    if (!idea && !input.title.trim() && !input.body.trim()) {
      return { ok: false, error: "Give Claude something to work from — a title or a line of copy." };
    }

    const result = await draftPost({
      brand, idea, title: input.title, body: input.body,
      channels: await loadChannels(input.brandId, input.channelIds, input.postId),
    });
    await logUsage(brand.id, user.id, input.postId ?? null, result.usage);
    return { ok: true, draft: result.draft, issues: result.issues };
  });
}

/**
 * Drafts a post in place — for the drafts the content plan fans out, which
 * nobody has written a word of yet. Refuses anything past draft stage, so a
 * post that is in review or scheduled can never be rewritten underneath people.
 */
export async function draftPostAction(postId: string): Promise<DraftResponse> {
  return guarded(async () => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) return { ok: false, error: "Post not found." };

    const { user, role } = await requireBrandRole(post.brandId, "editor");
    if (!can.edit(role)) return { ok: false, error: "You need editor access to draft posts." };
    if (!["draft", "changes_requested"].includes(post.status)) {
      return { ok: false, error: "Only drafts are rewritten. This post has moved on." };
    }

    const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
    if (!brand) return { ok: false, error: "Brand not found." };
    const idea = post.ideaId
      ? (await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, post.ideaId) })) ?? null
      : null;

    const targets = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
    const draftChannels = await loadChannels(post.brandId, targets.map((t) => t.channelId), post.id);

    // A fanned-out post's body is only the scaffold, so it is not passed back
    // in as "what the writer has so far" when there is an idea behind it.
    const result = await draftPost({
      brand, idea,
      title: idea ? "" : post.title,
      body: idea ? "" : post.body,
      channels: draftChannels,
    });
    const { draft } = result;

    await db.update(posts).set({
      // Keep a title someone chose; replace one that is just the idea's problem line.
      title: !post.title || post.title === idea?.problem ? draft.title : post.title,
      body: draft.body,
      updatedAt: new Date(),
    }).where(eq(posts.id, post.id));

    for (const v of draft.channels) {
      const target = targets.find((t) => t.channelId === v.channelId);
      const channel = draftChannels.find((c) => c.id === v.channelId);
      if (!target || !channel) continue;
      const supportsFirstComment = platformOrNull(channel.platform)?.constraints.supportsFirstComment;
      await db.update(postTargets).set({
        bodyOverride: v.body,
        firstComment: supportsFirstComment ? v.firstComment : target.firstComment,
      }).where(eq(postTargets.id, target.id));
    }

    await logUsage(brand.id, user.id, post.id, result.usage);
    revalidatePath("/ideas");
    revalidatePath(`/posts/${post.id}`);
    return { ok: true, draft, issues: result.issues };
  });
}
