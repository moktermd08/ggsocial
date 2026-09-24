import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { can } from "@/lib/auth";
import { db, brands as brandsTable, media } from "@/lib/db";
import { catalogueWithClaude, saveCatalog } from "@/server/media-catalog";
import { BudgetError, assertBudget } from "@/server/ai-usage";
import { masterAssets, masterOwnersFor } from "@/server/media-library";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Body = z.object({
  /** A brand slug or id, or "master" for the token owner's master library. */
  brand: z.string().min(1),
  limit: z.number().int().min(1).max(6).optional(),
});

/**
 * Has Claude look at images nobody has filed yet and file them. Up to six a
 * call; call again while `remaining` is above zero. A brand's filing counts
 * against its daily AI budget and stops once that is spent.
 *
 *   POST /api/agent/media/catalogue  { "brand": "acme" }
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const { brand: ref, limit = 6 } = parsed.data;

    const master = ref === "master";
    const b = master ? null : pickBrands(brands, ref)[0];
    if (!master && pickBrands(brands, ref).length !== 1) throw new AgentError("File one brand's library at a time.");
    if (b && !can.edit(b.role)) throw new AgentError(`The token's owner is a ${b.role} on ${b.slug} and cannot file its media.`, 403);

    const scope = b ? eq(media.brandId, b.id) : and(isNull(media.brandId), eq(media.ownerId, agent.userId));
    const unfiled = await db.select().from(media)
      .where(and(scope, isNull(media.catalogedAt), eq(media.kind, "image"), inArray(media.mimeType, ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"])));
    const library = b
      ? [...await db.select().from(media).where(eq(media.brandId, b.id)), ...await masterOwnersFor(agent.userId, [b.id]).then(masterAssets)]
      : await masterAssets([agent.userId]);
    const brandRow = b ? await db.query.brands.findFirst({ where: eq(brandsTable.id, b.id) }) ?? null : null;

    if (brandRow && unfiled.length) {
      try { await assertBudget(brandRow); }
      catch (e) { if (e instanceof BudgetError) throw new AgentError(e.message, 429); throw e; }
    }

    const batch = unfiled.slice(0, limit);
    const filed: { id: string; name: string; category: string | null; keywords: string[] }[] = [];
    const failed: { id: string; name: string; error: string }[] = [];
    await Promise.all(batch.map(async (row) => {
      try {
        const fields = await catalogueWithClaude(row, { brand: brandRow, library, source: "media:agent" });
        await saveCatalog(row.id, fields, "claude");
        filed.push({ id: row.id, name: row.originalName, category: fields.category, keywords: fields.tags });
      } catch (e) {
        failed.push({ id: row.id, name: row.originalName, error: e instanceof Error ? e.message : "Could not file it." });
      }
    }));
    return { filed, failed, remaining: unfiled.length - batch.length };
  });
}

export const dynamic = "force-dynamic";
