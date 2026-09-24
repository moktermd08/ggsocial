"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import {
  db, interactions, brands, channels, posts, postTargets, activity,
  type InteractionKind, type InteractionDirection, type InteractionStatus, type InteractionPriority,
  type InteractionSentiment,
} from "@/lib/db";
import { requireUser, requireBrandRole, can } from "@/lib/auth";

export type InteractionInput = {
  brandId: string;
  channelId?: string | null;
  postId?: string | null;
  kind: InteractionKind;
  direction?: InteractionDirection;
  priority?: InteractionPriority;
  sentiment?: InteractionSentiment | null;
  authorName?: string | null;
  authorHandle?: string | null;
  authorUrl?: string | null;
  authorReach?: number | null;
  body: string;
  externalUrl?: string | null;
  /** ISO. Defaults to now — most things are logged as they come in. */
  receivedAt?: string | null;
};

/** receivedAt plus the brand's SLA: the moment this stops being on time. */
function dueFrom(receivedAt: Date, slaMinutes: number) {
  return new Date(receivedAt.getTime() + Math.max(1, slaMinutes) * 60_000);
}

export async function logInteractionAction(input: InteractionInput) {
  return asResult(async () => {
    const { user, role } = await requireBrandRole(input.brandId, "editor");
    if (!can.edit(role)) throw new Error("You need editor access to log engagement.");

    const brand = await db.query.brands.findFirst({ where: eq(brands.id, input.brandId) });
    if (!brand) throw new Error("Brand not found.");

    const body = input.body.trim();
    if (!body) throw new Error("Write what was said, or what you mean to say.");

    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const [row] = await db.insert(interactions).values({
      brandId: input.brandId,
      channelId: input.channelId || null,
      postId: input.postId || null,
      kind: input.kind,
      direction: input.direction ?? "inbound",
      priority: input.priority ?? "normal",
      sentiment: input.sentiment ?? null,
      authorName: input.authorName?.trim() || null,
      authorHandle: input.authorHandle?.trim() || null,
      authorUrl: input.authorUrl?.trim() || null,
      authorReach: input.authorReach ?? null,
      body,
      externalUrl: input.externalUrl?.trim() || null,
      receivedAt,
      dueAt: dueFrom(receivedAt, brand.replySlaMinutes),
      createdBy: user.id,
    }).returning({ id: interactions.id });

    revalidatePath("/engage");
    return { id: row.id };
  });
}

/** Throws unless the row exists and the user can edit its brand. */
async function requireInteraction(interactionId: string) {
  const row = await db.query.interactions.findFirst({ where: eq(interactions.id, interactionId) });
  if (!row) throw new Error("That item is gone.");
  const { user, role } = await requireBrandRole(row.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to work this queue.");
  return { row, user };
}

export async function updateInteractionAction(input: {
  interactionId: string;
  status?: InteractionStatus;
  priority?: InteractionPriority;
  sentiment?: InteractionSentiment | null;
  replyBody?: string | null;
  notes?: string | null;
  assignToMe?: boolean;
  /** ISO. Sets status to "snoozed" and pushes the row down the queue. */
  snoozeUntil?: string | null;
}) {
  return asResult(async () => {
    const { row, user } = await requireInteraction(input.interactionId);

    const patch: Partial<typeof interactions.$inferInsert> = { updatedAt: new Date() };
    if (input.status) patch.status = input.status;
    if (input.priority) patch.priority = input.priority;
    if (input.sentiment !== undefined) patch.sentiment = input.sentiment;
    if (input.replyBody !== undefined) {
      patch.replyBody = input.replyBody?.trim() || null;
      // A person has made the reply their own; it no longer counts as an agent draft.
      if (patch.replyBody !== row.replyBody) patch.agentCode = null;
    }
    if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
    if (input.assignToMe) patch.assigneeId = user.id;
    if (input.snoozeUntil !== undefined) {
      patch.snoozedUntil = input.snoozeUntil ? new Date(input.snoozeUntil) : null;
      if (input.snoozeUntil) {
        patch.status = "snoozed";
        // The clock moves with the snooze, or the row comes back already late.
        patch.dueAt = new Date(input.snoozeUntil);
      }
    }

    await db.update(interactions).set(patch).where(eq(interactions.id, row.id));
    revalidatePath("/engage");
  });
}

/**
 * Marks an item answered. The reply itself still goes out on the platform —
 * only a handful of APIs let us post it — so this records that it happened and
 * stops the clock.
 */
export async function markRepliedAction(input: { interactionId: string; replyBody?: string; replyUrl?: string }) {
  return asResult(async () => {
    const { row, user } = await requireInteraction(input.interactionId);
    const repliedAt = new Date();

    await db.update(interactions).set({
      status: "replied",
      replyBody: input.replyBody?.trim() || row.replyBody,
      replyUrl: input.replyUrl?.trim() || null,
      repliedAt,
      assigneeId: row.assigneeId ?? user.id,
      updatedAt: repliedAt,
    }).where(eq(interactions.id, row.id));

    await db.insert(activity).values({
      brandId: row.brandId, actorId: user.id, action: "interaction.replied",
      entity: "interaction", entityId: row.id,
      meta: {
        kind: row.kind,
        // Minutes from arrival to reply — the number this whole queue exists to hold down.
        minutes: Math.max(0, Math.round((repliedAt.getTime() - row.receivedAt.getTime()) / 60_000)),
      },
    });

    revalidatePath("/engage");
  });
}

/**
 * Opens the engagement work for a post that just went live: one row per brand,
 * due inside the brand's SLA, listing where it landed.
 *
 * Called from the publish path, where it must never be the reason a post
 * fails — the caller swallows anything this throws.
 */
export async function openPostEngagement(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return;

  // One row per post, not per channel: nine near-identical reminders is how a
  // queue gets ignored.
  const existing = await db.select({ id: interactions.id }).from(interactions)
    .where(and(eq(interactions.postId, postId), eq(interactions.kind, "comment"), eq(interactions.direction, "outbound")));
  if (existing.length > 0) return;

  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand) return;

  const live = await db.select({ handle: channels.handle, platform: channels.platform })
    .from(postTargets).innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(eq(postTargets.postId, postId), eq(postTargets.status, "published")));
  if (live.length === 0) return;

  const publishedAt = post.publishedAt ?? new Date();
  await db.insert(interactions).values({
    brandId: post.brandId,
    postId,
    kind: "comment",
    direction: "outbound",
    priority: "high",
    body:
      `Work the comments on "${post.title || "this post"}" — ${live.map((l) => l.handle).join(", ")}.\n\n` +
      "Reply to every comment, and leave the first one yourself if the link belongs there.",
    receivedAt: publishedAt,
    dueAt: dueFrom(publishedAt, brand.replySlaMinutes),
    createdBy: post.createdBy,
  });

  revalidatePath("/engage");
}

/** Bulk triage from the queue's selection bar. */
export async function bulkUpdateInteractionsAction(ids: string[], status: InteractionStatus) {
  return asResult(async () => {
    if (ids.length === 0) return;
    const user = await requireUser();
    const rows = await db.select({ id: interactions.id, brandId: interactions.brandId })
      .from(interactions).where(inArray(interactions.id, ids));

    // Check each brand once rather than once per row.
    const brandIds = [...new Set(rows.map((r) => r.brandId))];
    const allowed = new Set<string>();
    for (const brandId of brandIds) {
      const { role } = await requireBrandRole(brandId, "editor");
      if (can.edit(role)) allowed.add(brandId);
    }

    const touch = rows.filter((r) => allowed.has(r.brandId)).map((r) => r.id);
    if (touch.length === 0) return;

    await db.update(interactions).set({
      status,
      repliedAt: status === "replied" ? new Date() : undefined,
      assigneeId: status === "replied" ? user.id : undefined,
      updatedAt: new Date(),
    }).where(inArray(interactions.id, touch));

    revalidatePath("/engage");
  });
}
