"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, links, posts, postTargets, channels } from "@/lib/db";
import { requireBrandRole, can } from "@/lib/auth";
import { newLinkCode, shortUrl } from "@/lib/links";
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

function normalizeDestination(raw: string) {
  const value = raw.trim();
  if (!value) throw new Error("Where should the link go?");
  // People paste "moksy.ai/pricing" far more often than they type the scheme.
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${raw}" is not a URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Links must be http or https.");
  return url.toString();
}

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
  /** Channel ids to issue for. Empty means one untargeted link for the brand. */
  channelIds: string[];
}): Promise<CreatedLink[]> {
  const { user, role } = await requireBrandRole(input.brandId, "editor");
  if (!can.edit(role)) throw new Error("You need editor access to create links.");

  const destination = normalizeDestination(input.destination);
  const label = input.label?.trim() || new URL(destination).pathname.replace(/^\/+|\/+$/g, "") || "Link";

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
      // utm_source is the platform, not the brand: that is what every
      // analytics tool in the world expects to find there.
      utmSource: platform?.id ?? null,
      utmMedium: "social",
      utmCampaign: input.campaign?.trim() || post?.campaign || null,
      utmContent: spec.channel?.handle ?? null,
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
