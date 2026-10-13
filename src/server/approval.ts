import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, activity, posts, postTargets, postVersions } from "@/lib/db";
import { versionPublishText, type ContentFormat } from "@/lib/formats";
import { sendAlert } from "@/server/alerts";

/**
 * Approval is for specific words. Whoever approves a post reads its copy; if
 * that copy changes afterwards (an editor saves a change, a master pushes an
 * update, an agent rewrites a channel), the approval no longer covers what
 * would go out, and the publisher will not send it.
 *
 * The fingerprint covers the words only: the post's title and text, and for
 * each channel the text it will really send and its first comment. Dates,
 * media files and platform options are left out on purpose: re-timing a
 * post, or adding the image a channel was waiting for, is not a change to
 * what was approved.
 */

export async function contentHash(postId: string): Promise<string | null> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return null;
  const [targets, versions] = await Promise.all([
    db.select().from(postTargets).where(eq(postTargets.postId, postId)),
    db.select().from(postVersions).where(eq(postVersions.postId, postId)),
  ]);
  const words = {
    title: post.title, body: post.body,
    channels: targets
      .filter((t) => t.status !== "skipped")
      .map((t) => {
        const v = t.useVersion ? versions.find((x) => x.id === t.versionId) : undefined;
        const text = v ? versionPublishText({ format: v.format as ContentFormat, body: v.body, outline: v.outline }) : t.bodyOverride;
        return [t.channelId, text ?? "", t.firstComment ?? ""];
      })
      .sort((a, b) => a[0].localeCompare(b[0])),
  };
  return createHash("sha256").update(JSON.stringify(words)).digest("hex");
}

/** Records that the post's words, as they are now, have been approved. */
export async function stampApproval(postId: string) {
  const hash = await contentHash(postId);
  if (hash) await db.update(posts).set({ approvedHash: hash }).where(eq(posts.id, postId));
}

/**
 * Before anything is sent: do the words still match what was approved? A post
 * approved before fingerprints existed has none and goes out as before.
 */
export async function approvalHolds(postId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId), columns: { approvedHash: true } });
  if (!post?.approvedHash) return { ok: true };
  const now = await contentHash(postId);
  if (now === post.approvedHash) return { ok: true };
  return { ok: false, reason: "Its copy changed after it was approved, so it needs approving again." };
}

/** Takes a changed post back to review: nothing unsent goes out until an approver looks again. */
export async function returnToReview(postId: string, reason: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return;
  await db.update(posts).set({ status: "in_review", approvedHash: null, updatedAt: new Date() }).where(eq(posts.id, postId));
  await db.update(postTargets).set({ status: "pending" })
    .where(and(eq(postTargets.postId, postId), inArray(postTargets.status, ["scheduled", "awaiting_manual"])));
  await db.insert(activity).values({
    brandId: post.brandId, actorId: null, action: "post.changed_after_approval", entity: "post", entityId: postId, meta: { reason },
  });
  await sendAlert({
    brandId: post.brandId, kind: "approval_stale", key: postId, path: `/posts/${postId}`,
    subject: `"${post.title || "A post"}" needs approving again`,
    lines: [reason, "It was held back instead of going out. Open it, check the new copy, and approve it."],
  });
}

/**
 * Posts approved before fingerprints existed are taken as approved in their
 * current words, so a later change to them is caught like any other. Cheap
 * and idempotent: it only touches posts that have none.
 */
export async function stampLegacyApprovals(limit = 100) {
  const rows = await db.select({ id: posts.id }).from(posts)
    .where(and(inArray(posts.status, ["scheduled", "approved"]), isNull(posts.approvedHash)))
    .limit(limit);
  for (const { id } of rows) await stampApproval(id);
  return rows.length;
}
