"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, links, posts, postTargets, channels, linkDestinations } from "@/lib/db";
import { requireBrandRole, can } from "@/lib/auth";
import { newLinkCode, normalizeDestination, shortUrl } from "@/lib/links";
import { platformOrNull } from "@/lib/platforms";

export type CreatedLink = {
  id: string;
  code: string;
  url: string;
  label: string;
  /** Platform id when the link belongs to one channel, else null. */
  platform: string | null;
  handle: string | null;
};

/** A code no existing link is using. Collisions are vanishingly rare but fatal. */
async function uniqueCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newLinkCode();
    const clash = await db.query.links.findFirst({ where: eq(links.code, code) });
    if (!clash) return code;
  }
  throw new Error("Could not allocate a short code. Try again.");
}

/**
 * Issues one tracked link per channel for a post.
 *
 * Per channel rather than per post on purpose: one link shared across nine
 * accounts tells you a hundred people clicked and nothing about where they
 * came from, which is the only question worth asking.
 */
export async function createPostLinksAction(input: {
  brandId: string;
  postId?: string | null;
  destination: string;
  label?: string;
  campaign?: string | null;
  /** A saved destination to issue from. Its URL and UTMs win, and the links keep following it. */
  destinationId?: string | null;
  /** Channel ids to issue for. Empty means one untargeted link for the brand. */
  channelIds: string[];
}): Promise<CreatedLink[]> {
  const { user, role } = await requireBrandRole(input.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to create links.");

  // Only this brand's own destinations, or a master one every brand can use.
  const saved = input.destinationId
    ? await db.query.linkDestinations.findFirst({ where: eq(linkDestinations.id, input.destinationId) })
    : null;
  if (input.destinationId && (!saved || (saved.brandId && saved.brandId !== input.brandId))) {
    throw new Error("That saved destination is not available to this brand.");
  }

  const destination = normalizeDestination(saved?.url ?? input.destination);
  const label = input.label?.trim() || saved?.name || new URL(destination).pathname.replace(/^\/+|\/+$/g, "") || "Link";

  const chans = input.channelIds.length
    ? await db.select().from(channels)
        .where(and(inArray(channels.id, input.channelIds), eq(channels.brandId, input.brandId)))
    : [];

  // Targets let a click be attributed to the exact row that published it.
  const targets = input.postId
    ? await db.select().from(postTargets).where(eq(postTargets.postId, input.postId))
    : [];

  const post = input.postId
    ? await db.query.posts.findFirst({ where: eq(posts.id, input.postId) })
    : null;

  const rows: CreatedLink[] = [];
  const specs = chans.length
    ? chans.map((c) => ({ channel: c, target: targets.find((t) => t.channelId === c.id) ?? null }))
    : [{ channel: null, target: null }];

  for (const spec of specs) {
    const code = await uniqueCode();
    const platform = spec.channel ? platformOrNull(spec.channel.platform) : null;
    const [row] = await db.insert(links).values({
      brandId: input.brandId,
      code,
      destination,
      label,
      postId: input.postId || null,
      channelId: spec.channel?.id ?? null,
      targetId: spec.target?.id ?? null,
      ideaId: post?.ideaId ?? null,
      destinationId: saved?.id ?? null,
      // utm_source is the platform, not the brand: that is what every
      // analytics tool in the world expects to find there.
      utmSource: platform?.id ?? null,
      utmMedium: "social",
      utmCampaign: saved?.utmCampaign || input.campaign?.trim() || post?.campaign || null,
      utmContent: saved?.utmContent || spec.channel?.handle || null,
      createdBy: user.id,
    }).returning({ id: links.id });

    rows.push({
      id: row.id,
      code,
      url: shortUrl(code),
      label,
      platform: spec.channel?.platform ?? null,
      handle: spec.channel?.handle ?? null,
    });
  }

  revalidatePath("/links");
  if (input.postId) revalidatePath(`/posts/${input.postId}`);
  return rows;
}

export async function updateLinkAction(input: {
  linkId: string;
  destination?: string;
  label?: string;
  utmCampaign?: string | null;
  utmContent?: string | null;
}) {
  const link = await db.query.links.findFirst({ where: eq(links.id, input.linkId) });
  if (!link) throw new Error("Link not found.");
  const { role } = await requireBrandRole(link.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to change links.");

  await db.update(links).set({
    destination: input.destination ? normalizeDestination(input.destination) : link.destination,
    label: input.label?.trim() ?? link.label,
    utmCampaign: input.utmCampaign !== undefined ? input.utmCampaign?.trim() || null : link.utmCampaign,
    utmContent: input.utmContent !== undefined ? input.utmContent?.trim() || null : link.utmContent,
    // Edited by hand: it stops following its saved destination, so a later
    // change there cannot quietly undo this.
    ...(input.destination || input.utmCampaign !== undefined || input.utmContent !== undefined ? { destinationId: null } : {}),
  }).where(eq(links.id, link.id));

  revalidatePath("/links");
}

/**
 * Retires a link. The row stays: its clicks are history, and the code is never
 * handed out again so an old post cannot start pointing somewhere new.
 */
export async function archiveLinkAction(linkId: string) {
  const link = await db.query.links.findFirst({ where: eq(links.id, linkId) });
  if (!link) throw new Error("Link not found.");
  const { role } = await requireBrandRole(link.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to retire links.");

  // Toggles, so an accidental retire is one click to undo.
  await db.update(links)
    .set({ archivedAt: link.archivedAt ? null : new Date() })
    .where(eq(links.id, linkId));

  revalidatePath("/links");
}
