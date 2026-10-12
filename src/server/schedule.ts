import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, brands, channels, posts, postTargets, postVersions } from "@/lib/db";
import type { EffectiveRule } from "@/lib/playbook/check";
import { resolveSchedule, snapToSchedule, type Schedule } from "@/lib/posting-schedule";
import { getBrandPlaybook } from "@/server/playbook";

/**
 * A channel posts only at its own times (see `src/lib/posting-schedule.ts`).
 * Every path that books a post goes through `snapPostTargets` afterwards, and
 * the publisher checks again before sending, so a time typed by hand, set by
 * an agent or dragged on the calendar still goes out on the channel's slot.
 * "Post now" is the one deliberate way around it.
 */

export function scheduleFor(
  channel: Pick<typeof channels.$inferSelect, "settings">,
  playbook: EffectiveRule[],
  format: string | null,
): Schedule {
  const rule = (code: string) => playbook.find((r) => r.code === code && r.enabled && r.kind === "format")?.limits ?? null;
  return resolveSchedule({
    channelSettings: channel.settings,
    formatRule: format && format !== "post" ? rule(format) : null,
    postRule: rule("post"),
  });
}

export type MovedTarget = { channelId: string; from: Date; to: Date };

/**
 * Moves each unsent, dated target of a post onto its channel's next slot, and
 * the post's own date to the earliest of them.
 */
export async function snapPostTargets(postId: string, now = new Date()): Promise<MovedTarget[]> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return [];
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand) return [];

  const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
  const open = targets.filter((t) => t.scheduledAt && ["pending", "scheduled", "failed"].includes(t.status));
  if (open.length === 0) return [];

  const [chanRows, versions, playbook] = await Promise.all([
    db.select().from(channels).where(inArray(channels.id, open.map((t) => t.channelId))),
    db.select().from(postVersions).where(eq(postVersions.postId, postId)),
    getBrandPlaybook(brand.id),
  ]);

  const moved: MovedTarget[] = [];
  for (const t of open) {
    const channel = chanRows.find((c) => c.id === t.channelId);
    if (!channel) continue;
    const format = versions.find((v) => v.id === t.versionId)?.format ?? post.postType ?? null;
    const at = snapToSchedule(t.scheduledAt!, scheduleFor(channel, playbook, format), brand.timezone, now);
    if (at.getTime() === t.scheduledAt!.getTime()) continue;
    await db.update(postTargets).set({ scheduledAt: at }).where(eq(postTargets.id, t.id));
    moved.push({ channelId: t.channelId, from: t.scheduledAt!, to: at });
    t.scheduledAt = at;
  }

  // The post carries the earliest of its unsent targets' times.
  if (moved.length) {
    const times = targets.filter((t) => t.scheduledAt && t.status !== "published").map((t) => t.scheduledAt!.getTime());
    if (times.length) {
      await db.update(posts).set({ scheduledAt: new Date(Math.min(...times)), updatedAt: new Date() }).where(eq(posts.id, postId));
    }
  }
  return moved;
}

/**
 * The publisher's last check before a send: when a due target is not on its
 * channel's schedule, give it the next slot and report that it must wait.
 */
export async function slotFor(target: typeof postTargets.$inferSelect, now = new Date()) {
  if (!target.scheduledAt) return null;
  const [post, channel] = await Promise.all([
    db.query.posts.findFirst({ where: eq(posts.id, target.postId) }),
    db.query.channels.findFirst({ where: eq(channels.id, target.channelId) }),
  ]);
  if (!post || !channel) return null;
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand) return null;
  const version = target.versionId
    ? await db.query.postVersions.findFirst({ where: eq(postVersions.id, target.versionId) })
    : null;
  const playbook = await getBrandPlaybook(brand.id);
  return snapToSchedule(target.scheduledAt, scheduleFor(channel, playbook, version?.format ?? post.postType ?? null), brand.timezone, now);
}
