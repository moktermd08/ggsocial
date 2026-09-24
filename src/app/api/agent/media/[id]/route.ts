import { z } from "zod";
import { eq } from "drizzle-orm";
import { can } from "@/lib/auth";
import { db, media } from "@/lib/db";
import { cleanCatalog, USE_CODES } from "@/lib/media-catalog";
import { saveCatalog } from "@/server/media-catalog";
import { masterOwnersFor } from "@/server/media-library";
import { AgentError, withAgent } from "@/server/agent-api";

const Body = z.object({
  description: z.string().max(1000).nullish(),
  category: z.string().max(60).nullish(),
  subcategory: z.string().max(60).nullish(),
  keywords: z.array(z.string().max(60)).max(40).optional(),
  uses: z.array(z.enum(USE_CODES as [string, ...string[]])).optional(),
  notes: z.string().max(1000).nullish(),
});

/**
 * File one library item. Fields left out keep what is there.
 *
 *   PATCH /api/agent/media/{id}
 *   { "description": "…", "category": "Product", "subcategory": "Close-up",
 *     "keywords": ["coffee", "latte art"], "uses": ["feed", "story"], "notes": "…" }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async ({ agent, brands }) => {
    const { id } = await params;
    const row = await db.query.media.findFirst({ where: eq(media.id, id) });
    if (!row) throw new AgentError("No media with that id.", 404);
    if (row.brandId) {
      const b = brands.find((x) => x.id === row.brandId);
      if (!b) throw new AgentError("No media with that id.", 404);
      if (!can.edit(b.role)) throw new AgentError(`The token's owner is a ${b.role} on ${b.slug} and cannot file its media.`, 403);
    } else if (row.ownerId !== agent.userId) {
      const visible = row.ownerId && (await masterOwnersFor(agent.userId, brands.map((b) => b.id))).includes(row.ownerId);
      throw new AgentError(visible ? "Only the owner of a master asset can file it." : "No media with that id.", visible ? 403 : 404);
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const p = parsed.data;
    const fields = cleanCatalog({
      altText: p.description !== undefined ? p.description : row.altText,
      category: p.category !== undefined ? p.category : row.category,
      subcategory: p.subcategory !== undefined ? p.subcategory : row.subcategory,
      tags: p.keywords ?? row.tags,
      uses: p.uses ?? row.uses,
      usageNotes: p.notes !== undefined ? p.notes : row.usageNotes,
    });
    await saveCatalog(row.id, fields, agent.userId);
    return {
      id: row.id, description: fields.altText, category: fields.category, subcategory: fields.subcategory,
      keywords: fields.tags, uses: fields.uses, notes: fields.usageNotes,
    };
  });
}

export const dynamic = "force-dynamic";
