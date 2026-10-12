"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, activity, postTargets, postVersions, posts, channels } from "@/lib/db";
import { requireBrandRole } from "@/lib/auth";
import { isFormat, versionOptions, VERSION_STATUSES, type ContentFormat, type VersionStatus } from "@/lib/formats";
import { assignVersions, generateVersions } from "@/server/versions";

async function loadPost(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) throw new Error("Post not found");
  const { user } = await requireBrandRole(post.brandId, "editor");
  return { post, user };
}

async function loadVersion(versionId: string) {
  const version = await db.query.postVersions.findFirst({ where: eq(postVersions.id, versionId) });
  if (!version) throw new Error("Version not found");
  return { version, ...(await loadPost(version.postId)) };
}

const refresh = () => revalidatePath("/", "layout");

/** Has Claude write the post in every format its channels need (or just the ones asked for). */
export async function generateVersionsAction(postId: string, formats?: string[]) {
  return asResult(async () => {
    const { post, user } = await loadPost(postId);
    const picked = formats?.filter(isFormat);
    const out = await generateVersions(postId, { formats: picked, source: "versions" });
    await db.insert(activity).values({
      brandId: post.brandId, actorId: user.id, action: "post.versions_generated", entity: "post", entityId: postId,
      meta: { formats: out.made },
    });
    refresh();
    return { made: out.made as string[], issues: out.issues, note: out.note };
  });
}

/** Adds an empty version to fill in by hand. */
export async function addVersionAction(postId: string, format: string) {
  return asResult(async () => {
    const { post } = await loadPost(postId);
    if (!isFormat(format)) throw new Error("Unknown format.");
    await db.insert(postVersions).values({ postId, format, title: post.title, body: post.body, status: "outline" })
      .onConflictDoNothing();
    refresh();
  });
}

export async function saveVersionAction(versionId: string, input: {
  title: string; body: string; outline: string[]; script: string; mediaIds?: string[];
}) {
  return asResult(async () => {
    const { version } = await loadVersion(versionId);
    await db.update(postVersions).set({
      title: input.title, body: input.body, script: input.script,
      outline: input.outline.map((l) => l.trim()).filter(Boolean),
      ...(input.mediaIds ? { mediaIds: input.mediaIds } : {}),
      // An edited version has been looked at by a person but is not signed off again.
      status: version.status === "ready" ? "drafted" : version.status,
      agentCode: null,
      updatedAt: new Date(),
    }).where(eq(postVersions.id, versionId));
    refresh();
  });
}

export async function setVersionStatusAction(versionId: string, status: string) {
  return asResult(async () => {
    const { version, post, user } = await loadVersion(versionId);
    if (!(VERSION_STATUSES as readonly string[]).includes(status)) throw new Error("Unknown status.");
    await db.update(postVersions).set({ status: status as VersionStatus, updatedAt: new Date() }).where(eq(postVersions.id, versionId));
    await db.insert(activity).values({
      brandId: post.brandId, actorId: user.id, action: `post.version_${status}`, entity: "post_version", entityId: version.id,
      meta: { format: version.format },
    });
    refresh();
  });
}

export async function deleteVersionAction(versionId: string) {
  return asResult(async () => {
    await loadVersion(versionId);
    await db.delete(postVersions).where(eq(postVersions.id, versionId));
    refresh();
  });
}

/** Points one channel at a version, or back at the post as written. */
export async function assignTargetVersionAction(targetId: string, versionId: string | null) {
  return asResult(async () => {
    const target = await db.query.postTargets.findFirst({ where: eq(postTargets.id, targetId) });
    if (!target) throw new Error("Channel not found on this post.");
    await loadPost(target.postId);
    if (target.status === "published") throw new Error("That channel has already published.");
    const channel = await db.query.channels.findFirst({ where: eq(channels.id, target.channelId) });
    if (!channel) throw new Error("Channel not found.");

    let options = { ...(target.options ?? {}) };
    if (versionId) {
      const version = await db.query.postVersions.findFirst({ where: eq(postVersions.id, versionId) });
      if (!version || version.postId !== target.postId) throw new Error("That version belongs to another post.");
      options = { ...options, ...versionOptions(channel.platform, version.format as ContentFormat) };
    }
    await db.update(postTargets).set({ versionId, options }).where(eq(postTargets.id, targetId));
    refresh();
  });
}

/** Re-points every unpublished channel at the best version it has. */
export async function autoAssignVersionsAction(postId: string) {
  return asResult(async () => {
    await loadPost(postId);
    const changed = await assignVersions(postId, { reset: true });
    refresh();
    return { changed };
  });
}
