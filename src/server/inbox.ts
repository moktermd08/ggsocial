import "server-only";
import { and, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, brands, channels, interactions, postTargets } from "@/lib/db";
import { getPlatform } from "@/lib/platforms";
import { freshCredentials, isRevokedToken, markReconnect, ReconnectError } from "@/server/channel-auth";

/**
 * Brings what people say to the brand into Engagement by itself: every few
 * minutes each live channel is asked for new comments on the brand's recent
 * posts, and each one lands as a "new" inbound item with its reply-by time —
 * where the community manager picks it up. Re-reading the same comment never
 * makes a second row (the channel + platform id is unique).
 */

const EVERY_MS = 10 * 60_000;
/** A channel's first read reaches this far back. */
const FIRST_LOOK_MS = 3 * 86_400_000;
/** Comments are read on posts published in this window. */
const POSTS_MS = 30 * 86_400_000;

export async function pullInbound(now = new Date(), budgetMs = 60_000) {
  const started = Date.now();
  const due = await db.select({ channel: channels, brand: brands }).from(channels)
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(and(
      eq(channels.mode, "live"), isNull(channels.archivedAt), isNull(brands.archivedAt),
      or(isNull(channels.inboxCheckedAt), lt(channels.inboxCheckedAt, new Date(now.getTime() - EVERY_MS))),
    ));

  const report: { channel: string; added?: number; error?: string }[] = [];
  for (const { channel, brand } of due) {
    if (Date.now() - started > budgetMs) break;
    const platform = getPlatform(channel.platform);
    if (!platform.fetchInbound) continue;

    const since = channel.inboxCheckedAt ?? new Date(now.getTime() - FIRST_LOOK_MS);
    const published = await db.select({ id: postTargets.id, postId: postTargets.postId, externalPostId: postTargets.externalPostId })
      .from(postTargets)
      .where(and(eq(postTargets.channelId, channel.id), eq(postTargets.status, "published"),
        isNotNull(postTargets.externalPostId), gte(postTargets.publishedAt, new Date(now.getTime() - POSTS_MS))));
    const byExternal = new Map(published.map((t) => [t.externalPostId!, t]));

    try {
      const credentials = await freshCredentials(channel);
      const items = await platform.fetchInbound({ channel, credentials, since, posts: [...byExternal.keys()] });
      let added = 0;
      if (items.length) {
        const rows = await db.insert(interactions).values(items.map((i) => {
          const target = i.externalPostId ? byExternal.get(i.externalPostId) : undefined;
          return {
            brandId: brand.id, channelId: channel.id, postId: target?.postId ?? null, targetId: target?.id ?? null,
            kind: i.kind, direction: "inbound" as const, status: "new" as const,
            authorName: i.authorName ?? null, authorHandle: i.authorHandle ?? null, authorUrl: i.authorUrl ?? null,
            body: i.body, externalId: i.externalId, externalUrl: i.externalUrl ?? null,
            receivedAt: i.receivedAt, dueAt: new Date(i.receivedAt.getTime() + brand.replySlaMinutes * 60_000),
          };
        })).onConflictDoNothing().returning({ id: interactions.id });
        added = rows.length;
      }
      await db.update(channels).set({ inboxCheckedAt: now }).where(eq(channels.id, channel.id));
      report.push({ channel: channel.handle, added });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ReconnectError) {
        report.push({ channel: channel.handle, error: message });
        continue;
      }
      if (isRevokedToken(err)) await markReconnect(channel, `${platform.name} no longer accepts the sign-in. Connect it again.`);
      else await db.update(channels).set({ lastError: `Could not read comments: ${message.slice(0, 300)}`, inboxCheckedAt: now })
        .where(eq(channels.id, channel.id));
      report.push({ channel: channel.handle, error: message });
    }
  }
  return report;
}
