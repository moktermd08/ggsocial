import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, attachments, brands, channels, integrations, media, memberships, postTargets, postVersions, posts } from "@/lib/db";
import { formatsForPlatform } from "@/lib/formats";
import { storeBuffer } from "@/server/media";
import { getAccessToken } from "@/server/integrations/oauth";
import * as canva from "@/server/integrations/canva";
import { truncate } from "@/lib/format";
import { generateVersions } from "@/server/versions";

/**
 * Makes the images a post needs when nothing in the brand's library fits: the
 * brand's own Canva template, filled with the post's words, exported and filed.
 * The playbook has every visual made in Canva from the brand kit, and this
 * keeps to that — the agent fills the brand's template, it does not draw.
 *
 * Needs, on the brand: a template (Workflows → Images), and an owner or admin
 * who has connected Canva. Anything missing comes back as a plain reason so
 * the post falls back to a person, never an error.
 */

export type MadeImages =
  | { ok: true; mediaIds: string[]; summary: string }
  | { ok: false; reason: string };

const MAX_SLIDES = 10;

/** Canva account of someone who runs the brand: the agent borrows their connection. */
async function canvaUserFor(brandId: string) {
  const rows = await db.select({ userId: integrations.userId, role: memberships.role }).from(memberships)
    .innerJoin(integrations, eq(integrations.userId, memberships.userId))
    .where(and(eq(memberships.brandId, brandId), eq(integrations.provider, "canva"), inArray(memberships.role, ["owner", "admin"])))
    .orderBy(asc(memberships.createdAt));
  return rows.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"))[0]?.userId ?? null;
}

/** The first sentence of the post, trimmed to something that reads on an image. */
export function hookOf(body: string) {
  const first = body.replace(/#\S+/g, "").trim().split(/(?<=[.!?])\s|\n/)[0] ?? "";
  return truncate(first.trim(), 90);
}

/** What goes on each image: a carousel's slides, otherwise the post's hook. */
export async function imageTexts(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return [];
  const findCarousel = () => db.query.postVersions.findFirst({
    where: and(eq(postVersions.postId, postId), eq(postVersions.format, "carousel")),
  });
  let carousel = await findCarousel();
  // A carousel post needs its slides before it can have images; write them if the channels did not ask for that format.
  if (post.postType?.toLowerCase() === "carousel" && !(carousel?.outline.length)) {
    await generateVersions(postId, { formats: ["carousel"], source: "workflow:publish-post", agentCode: "writer" }).catch(() => null);
    carousel = await findCarousel();
  }
  const slides = (carousel?.outline ?? []).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SLIDES);
  // Slides when the post is a carousel, or when a channel of it takes carousels (Instagram, LinkedIn) and the slides exist.
  const channelsTakeCarousel = (await db.select({ platform: channels.platform }).from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId)).where(eq(postTargets.postId, postId)))
    .some((c) => formatsForPlatform(c.platform).includes("carousel"));
  if (slides.length >= 2 && (post.postType?.toLowerCase() === "carousel" || channelsTakeCarousel)) return slides;
  return [hookOf(post.body) || post.title];
}

/** Which template field takes which text: headline-ish first, then anything else for the rest. */
export function mapFields(fields: canva.TemplateField[], text: string, support: string) {
  const texts = fields.filter((f) => f.type === "text");
  if (texts.length === 0) return null;
  const head = texts.find((f) => /head|title|hook|main/i.test(f.name)) ?? texts[0];
  const sub = texts.find((f) => f !== head && /sub|body|text|caption|detail/i.test(f.name)) ?? texts.find((f) => f !== head);
  const out: Record<string, string> = { [head.name]: text };
  if (sub) out[sub.name] = support;
  // Fill every other text field with something harmless rather than leave template placeholder copy.
  for (const f of texts) if (!(f.name in out)) out[f.name] = "";
  return out;
}

export async function generatePostImages(postId: string): Promise<MadeImages> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return { ok: false, reason: "The post is gone." };
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand?.canvaTemplateId) return { ok: false, reason: "No Canva template is set for this brand (Workflows → Images)." };
  const userId = await canvaUserFor(brand.id);
  if (!userId) return { ok: false, reason: "No owner or admin of this brand has connected Canva." };

  const ids: string[] = [];
  try {
    const token = await getAccessToken(userId, "canva");
    const fields = await canva.getTemplateFields(token, brand.canvaTemplateId);
    const texts = await imageTexts(postId);
    if (texts.length === 0) return { ok: false, reason: "The post has no words to put on an image." };
    const support = brand.tagline ?? brand.name;

    for (const [i, text] of texts.entries()) {
      const mapped = mapFields(fields, text, support);
      if (!mapped) return { ok: false, reason: "The brand's Canva template has no text field to fill." };
      const design = await canva.autofillTemplate(token, brand.canvaTemplateId, `${post.title || brand.name} ${texts.length > 1 ? i + 1 : ""}`.trim(), mapped);
      const [file] = await canva.exportDesign(token, design.id, "png");
      const name = `${(post.title || "post").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "post"}${texts.length > 1 ? ` ${i + 1}` : ""}.png`;
      const stored = await storeBuffer(file.buffer, name, file.mimeType);
      const [row] = await db.insert(media).values({
        brandId: brand.id, kind: stored.kind, url: stored.url, originalName: name, mimeType: file.mimeType, size: stored.size,
        source: "canva", sourceUrl: design.editUrl, altText: text, uploadedBy: userId,
      }).returning({ id: media.id });
      await db.insert(attachments).values({ postId, mediaId: row.id, position: i });
      ids.push(row.id);
    }
    return {
      ok: true, mediaIds: ids,
      summary: `Made ${ids.length} image${ids.length === 1 ? "" : "s"} from the brand's Canva template.`,
    };
  } catch (err) {
    // A carousel that stopped halfway is worse than none: take back what it attached.
    if (ids.length) await db.delete(attachments).where(and(eq(attachments.postId, postId), inArray(attachments.mediaId, ids)));
    return { ok: false, reason: err instanceof Error ? err.message : "Canva refused." };
  }
}
