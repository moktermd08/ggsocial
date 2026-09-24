import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { BetaImageBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, contentIdeas, media, posts, type brands } from "@/lib/db";
import { MEDIA_USES, USE_CODES, categoriesIn, cleanCatalog, rankForText, searchMedia, type MediaQuery } from "@/lib/media-catalog";
import { DraftingError, client, explain } from "@/server/drafting";
import { readLocalUpload, publicUrl } from "@/server/media";
import { brandLibraries, type LibraryItem, type MediaFile } from "@/server/media-library";

/* --------------------------------------------------------- Claude, by eye */

const CatalogSchema = z.object({
  description: z.string().describe("One or two plain sentences on what the image shows, written as alt text."),
  category: z.string().describe("The shelf it belongs on. Reuse an existing category whenever one fits."),
  subcategory: z.string().nullable().describe("A narrower spot on that shelf, reusing an existing one where it fits."),
  keywords: z.array(z.string()).describe("8 to 20 lowercase search words: subjects, objects, setting, colours, mood, season, text shown, people (never names you cannot see written)."),
  uses: z.array(z.enum(USE_CODES as [string, ...string[]])).describe("Where it would work well."),
  usageNotes: z.string().nullable().describe("When not to use it, or what to know first — text baked in, a dated offer, a busy area that needs cropping. null if nothing."),
});

const SYSTEM = `You catalogue a social media team's image library so people and AI agents can find the right picture later by searching words.

Look at the image and file it:
- Reuse the library's existing categories and subcategories when one fits; only invent a new one when nothing does. Keep new names short, Title Case.
- Keywords are what someone would type to find this: the subject, objects, setting, colours, mood, season or occasion, any words printed on it, and the kind of shot (close-up, flat lay, portrait, screenshot, graphic).
- Uses: judge by the shape and content. Portrait (9:16-ish) suits stories; square or 4:5 suits feed posts; wide suits banners, web and email headers. An image with lots of calm empty space suits "background". Logos suit "profile". Text-heavy graphics rarely suit ads or backgrounds.
- Be literal. Do not guess people's names, places or brands that are not visibly shown.

Uses you may pick: ${MEDIA_USES.map((u) => `${u.code} (${u.label})`).join(", ")}.`;

/**
 * Filing is looking and labelling, so a mid-size model does it well. Follows
 * CLAUDE_ANALYSIS_MODEL when that is set, like the agents' analysis work.
 */
const MODEL = process.env.CLAUDE_ANALYSIS_MODEL || "claude-sonnet-5";

const READABLE = ["image/jpeg", "image/png", "image/gif", "image/webp"];
/** Base64 grows a file by a third; the API takes up to 5 MB per image. */
const INLINE_MAX = 3_700_000;

async function imageSource(row: MediaFile): Promise<BetaImageBlockParam["source"]> {
  const type = row.mimeType === "image/jpg" ? "image/jpeg" : row.mimeType;
  if (row.kind !== "image" || !READABLE.includes(type)) {
    throw new DraftingError(`${row.originalName}: Claude can catalogue JPEG, PNG, GIF and WebP images. File this one by hand.`);
  }
  const local = row.url.match(/^\/api\/media\/file\/([^/?#]+)/);
  let buf: Buffer | null = null;
  try {
    buf = local ? await readLocalUpload(local[1]) : Buffer.from(await (await fetch(row.url)).arrayBuffer());
  } catch { /* fall back to the URL below */ }
  if (buf && buf.length <= INLINE_MAX) {
    return { type: "base64", media_type: type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: buf.toString("base64") };
  }
  const url = publicUrl(row.url);
  if (url.startsWith("https://")) return { type: "url", url };
  throw new DraftingError(`${row.originalName} is too large to send to Claude from here. File this one by hand.`);
}

/**
 * Asks Claude to look at one image and file it, reusing the shelves the
 * library already has. Returns the cleaned fields; the caller saves them.
 */
export async function catalogueWithClaude(row: MediaFile, opts: {
  brand?: typeof brands.$inferSelect | null;
  library: Parameters<typeof categoriesIn>[0];
}) {
  const source = await imageSource(row);
  const shelves = categoriesIn(opts.library)
    .map((c) => `- ${c.name}${c.subcategories.length ? `: ${c.subcategories.join(", ")}` : ""}`).join("\n");
  const about = opts.brand
    ? `This file is in the library of the brand "${opts.brand.name}".${opts.brand.brief ? ` About the brand: ${opts.brand.brief.slice(0, 600)}` : ""}`
    : "This file is in the master library, shared by several related brands.";
  const task = [
    about,
    `File name: ${row.originalName}${row.width && row.height ? ` · ${row.width}×${row.height}px` : ""}`,
    `Existing categories:\n${shelves}`,
  ].join("\n\n");

  const api = client();
  try {
    const res = await api.beta.messages.parse({
      model: MODEL,
      max_tokens: 4_000,
      output_config: { effort: "low", format: betaZodOutputFormat(CatalogSchema) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "image", source }, { type: "text", text: task }] }],
    } satisfies Parameters<Anthropic["beta"]["messages"]["parse"]>[0]);
    if (res.stop_reason === "refusal") throw new DraftingError(`Claude declined to describe ${row.originalName}.`);
    const out = res.parsed_output;
    if (!out) throw new DraftingError(`Claude's answer for ${row.originalName} could not be read.`);
    return cleanCatalog({
      altText: out.description, category: out.category, subcategory: out.subcategory,
      tags: out.keywords, uses: out.uses, usageNotes: out.usageNotes,
    });
  } catch (err) {
    explain(err);
  }
}

export async function saveCatalog(id: string, fields: ReturnType<typeof cleanCatalog>, by: string) {
  await db.update(media).set({ ...fields, catalogedAt: new Date(), catalogedBy: by }).where(eq(media.id, id));
}

/* ------------------------------------------------------------- searching */

/**
 * A brand version that nobody has filed yet borrows the master's catalogue,
 * so swapping in a brand's own logo does not make it unfindable.
 */
export function withInheritedCatalog(m: LibraryItem): LibraryItem {
  const from = m.versionOf;
  if (m.catalogedAt || !from?.catalogedAt) return m;
  return {
    ...m, altText: m.altText ?? from.altText, tags: m.tags.length ? m.tags : from.tags,
    category: from.category, subcategory: from.subcategory, uses: from.uses,
    usageNotes: from.usageNotes, catalogedAt: from.catalogedAt, catalogedBy: from.catalogedBy,
  };
}

/** One brand's library — its own files and the master assets it uses — ranked for a query. */
export async function searchBrandLibrary(userId: string, brandId: string, query: MediaQuery) {
  const items = ((await brandLibraries(userId, [brandId])).get(brandId) ?? []).map(withInheritedCatalog);
  return { items: searchMedia(items, query), library: items };
}

/**
 * The library files that best fit a saved post — its words, its idea and its
 * format — for an agent or a workflow step to attach or offer. Only files
 * someone has catalogued can be told apart, so unfiled ones never rank.
 */
export async function suggestMediaForPost(postId: string, opts: { userId?: string; limit?: number } = {}) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return null;
  const idea = post.ideaId ? await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, post.ideaId) }) : null;
  const { library } = await searchBrandLibrary(opts.userId ?? "", post.brandId, {});
  const text = [
    post.title, post.body, post.campaign,
    idea && [idea.title, idea.pillar, idea.problem, idea.action, idea.outcome, ...idea.hashtags].filter(Boolean).join(" "),
  ].filter(Boolean).join("\n");
  const ranked = rankForText(library.filter((m) => m.catalogedAt), text, { format: post.postType });
  return { post, candidates: ranked.slice(0, opts.limit ?? 5) };
}
