import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, attachments, media } from "@/lib/db";
import type { MediaItem } from "@/lib/platforms";

/**
 * The files a channel's copy goes out with, in order: ones attached to that
 * channel itself, else the post's; a format version that brings its own media
 * (a reel's clip) wins over the post's but not over the channel's.
 */
export function mediaForTarget(
  rows: { targetId: string | null; item: MediaItem }[],
  targetId: string,
  versionMedia: MediaItem[] | null,
): MediaItem[] {
  const own = rows.filter((r) => r.targetId === targetId);
  if (own.length) return own.map((r) => r.item);
  if (versionMedia?.length) return versionMedia;
  return rows.filter((r) => r.targetId === null).map((r) => r.item);
}

export async function attachmentRows(postId: string) {
  return (await db
    .select({ attachment: attachments, item: media })
    .from(attachments)
    .innerJoin(media, eq(media.id, attachments.mediaId))
    .where(eq(attachments.postId, postId))
    .orderBy(asc(attachments.position))).map((r) => ({ targetId: r.attachment.targetId, item: r.item }));
}

export async function versionMediaItems(mediaIds: string[]): Promise<MediaItem[] | null> {
  if (mediaIds.length === 0) return null;
  const own = await db.select().from(media).where(inArray(media.id, mediaIds));
  return mediaIds.map((id) => own.find((m) => m.id === id)).filter((m): m is MediaItem => Boolean(m));
}
