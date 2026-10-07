import { z } from "zod";
import { can } from "@/lib/auth";
import { getAccessToken } from "@/server/integrations/oauth";
import * as canva from "@/server/integrations/canva";
import { importCanvaDesign } from "@/server/integrations/canva-import";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Body = z.object({
  brand: z.string().min(1),
  /** A design id, or its Canva link (canva.com/design/DAF…/…). */
  design: z.string().min(1),
  format: z.enum(canva.CANVA_FORMATS).default("mp4"),
  quality: z.enum(canva.CANVA_VIDEO_QUALITIES).default("vertical_1080p"),
});

function designId(input: string) {
  const s = input.trim();
  return s.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/)?.[1] ?? s;
}

/**
 * Find a design in the token owner's Canva (the one connected under Media).
 *
 *   GET /api/agent/media/canva?q=launch+video
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ agent }) => {
    const q = new URL(req.url).searchParams.get("q")?.trim() || undefined;
    try {
      const token = await getAccessToken(agent.userId, "canva");
      const { designs } = await canva.listDesigns(token, { query: q });
      return { designs: designs.slice(0, 20).map((d) => ({ id: d.id, title: d.title, editUrl: d.editUrl, pages: d.pageCount, updatedAt: d.updatedAt })) };
    } catch (e) {
      throw new AgentError(e instanceof Error ? e.message : "Canva refused.", 400);
    }
  });
}

/**
 * Render a Canva design on the server and file it in a brand's media library,
 * so the file never has to pass through the agent. Uses the Canva connection of
 * the person who owns the token. A video can take a few minutes to render.
 *
 *   POST /api/agent/media/canva
 *   { "brand": "acme", "design": "DAFxyz… or the design link", "format": "mp4", "quality": "vertical_1080p" }
 *
 * Returns the new file's `id`: use it as a `mediaIds` entry in POST /api/agent/posts.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const d = parsed.data;

    const picked = pickBrands(brands, d.brand);
    if (picked.length !== 1) throw new AgentError("Name exactly one brand.");
    const brand = picked[0];
    if (!can.edit(brand.role)) throw new AgentError(`The token's owner is a ${brand.role} on ${brand.slug} and cannot add media.`, 403);

    try {
      const files = await importCanvaDesign({
        userId: agent.userId, brandId: brand.id, designId: designId(d.design), format: d.format, quality: d.quality,
      });
      return { brand: brand.slug, files };
    } catch (e) {
      throw new AgentError(e instanceof Error ? e.message : "Canva import failed.", 400);
    }
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
