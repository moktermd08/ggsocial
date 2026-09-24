import { z } from "zod";
import { orientationOf, searchMedia, USE_CODES, type Orientation } from "@/lib/media-catalog";
import { publicUrl } from "@/server/media";
import { searchBrandLibrary, suggestMediaForPost } from "@/server/media-catalog";
import type { LibraryItem } from "@/server/media-library";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Query = z.object({
  brand: z.string().optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  use: z.enum(USE_CODES as [string, ...string[]]).optional(),
  orientation: z.enum(["square", "portrait", "landscape"]).optional(),
  kind: z.enum(["image", "video", "document"]).optional(),
  unfiled: z.enum(["1", "true"]).optional(),
  postId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** One library file as an agent reads it: where to fetch it, and how it is filed. */
function mediaJson(m: LibraryItem) {
  return {
    id: m.id,
    url: publicUrl(m.url),
    kind: m.kind,
    name: m.originalName,
    mimeType: m.mimeType,
    width: m.width, height: m.height, orientation: orientationOf(m.width, m.height),
    durationSeconds: m.durationMs ? Math.round(m.durationMs / 1000) : null,
    description: m.altText,
    category: m.category, subcategory: m.subcategory,
    keywords: m.tags, uses: m.uses, notes: m.usageNotes,
    filed: m.catalogedAt ? { at: m.catalogedAt.toISOString(), by: m.catalogedBy === "claude" ? "claude" : "person" } : null,
    master: m.isMaster, versionOf: m.versionOf?.id ?? null,
    source: m.source, sourceUrl: m.sourceUrl,
  };
}

/**
 * Search the media library — each brand's own files plus the master assets it
 * uses — by words, category, use and shape. Best match first.
 *
 *   GET /api/agent/media?brand=acme&q=coffee+morning&use=story&orientation=portrait
 *   GET /api/agent/media?postId=…   the best files for a saved post, with why
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const f = parsed.data;

    if (f.postId) {
      const found = await suggestMediaForPost(f.postId, { userId: agent.userId, limit: f.limit ?? 5 });
      if (!found || !brands.some((b) => b.id === found.post.brandId)) throw new AgentError("No post with that id on your brands.", 404);
      return {
        postId: found.post.id,
        candidates: found.candidates.map((c) => ({
          ...mediaJson(c.item), matched: c.matched, fitsFormat: c.fitsUse || c.fitsShape,
        })),
        hint: found.candidates.length
          ? "Attach one by saving the post with its id in mediaIds, or leave the choice to a person."
          : "Nothing filed in this brand's library fits. File the library (POST /api/agent/media/catalogue) or ask a person for an image.",
      };
    }

    const picked = pickBrands(brands, f.brand);
    const query = {
      q: f.q, category: f.category, subcategory: f.subcategory, use: f.use,
      orientation: f.orientation as Orientation | undefined, kind: f.kind, uncatalogued: !!f.unfiled,
    };
    const out = [];
    for (const b of picked) {
      const { items, library } = await searchBrandLibrary(agent.userId, b.id, query);
      out.push({
        brand: b.slug,
        total: library.length,
        unfiled: library.filter((m) => !m.catalogedAt).length,
        matches: items.length,
        media: searchMedia(items, {}).slice(0, f.limit ?? 30).map(mediaJson),
      });
    }
    return { brands: out };
  });
}

export const dynamic = "force-dynamic";
