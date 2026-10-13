import "server-only";
import { and, eq, gte, lte, ne, inArray } from "drizzle-orm";
import { db, brandAgents, posts } from "@/lib/db";
import { openSlots } from "@/lib/agents/slots";
import { getBrandPlaybooks } from "@/server/playbook";
import { goalPostsPerWeek } from "@/server/agents/writer";
import { unbookedIdeas } from "@/server/ideas";

const DAY = 86_400_000;
const AHEAD_DAYS = 42;

export type ProjectedIdea = {
  ideaId: string;
  title: string;
  status: string;
  brandId: string;
  brandName: string;
  brandColor: string;
  at: Date;
  /** False when the brand's content writer is off, so nothing will write it by itself. */
  writerOn: boolean;
};

/**
 * Where each unwritten idea will land if the content writer carries on as it
 * does: each brand's open posting slots, taken in plan order, using the same
 * slot rules as the writer. A forecast, never a booking — the writer decides
 * when it runs, and a person can write an idea sooner.
 */
export async function projectIdeas(args: {
  userId: string; myBrandIds: string[]; brands: { id: string; timezone: string }[]; now?: Date;
}): Promise<{ projected: ProjectedIdea[]; waiting: Awaited<ReturnType<typeof unbookedIdeas>> }> {
  const now = args.now ?? new Date();
  const scopeIds = args.brands.map((b) => b.id);
  const waiting = await unbookedIdeas(args.userId, args.myBrandIds, scopeIds, 200);
  if (waiting.length === 0) return { projected: [], waiting };

  const [playbooks, agents, taken] = await Promise.all([
    getBrandPlaybooks(scopeIds),
    db.select().from(brandAgents).where(and(inArray(brandAgents.brandId, scopeIds), eq(brandAgents.agentCode, "writer"))),
    db.select({ brandId: posts.brandId, at: posts.scheduledAt }).from(posts).where(and(
      inArray(posts.brandId, scopeIds), ne(posts.status, "failed"),
      gte(posts.scheduledAt, new Date(now.getTime() - 8 * DAY)), lte(posts.scheduledAt, new Date(now.getTime() + (AHEAD_DAYS + 2) * DAY)),
    )),
  ]);

  const projected: ProjectedIdea[] = [];
  for (const brand of args.brands) {
    const queue = waiting.filter((w) => w.missing.some((m) => m.id === brand.id));
    if (queue.length === 0) continue;
    const meta = queue[0].missing.find((m) => m.id === brand.id)!;
    const agent = agents.find((a) => a.brandId === brand.id);
    const rule = playbooks.get(brand.id)?.find((r) => r.code === "post" && r.enabled);
    const setting = Number(agent?.settings?.perWeek);
    const perWeek = Math.min(21, Math.max(1, Number.isFinite(setting) && setting > 0 ? Math.round(setting) : (await goalPostsPerWeek(brand.id)) ?? rule?.limits.perWeek ?? 5));
    const slots = openSlots({
      timezone: brand.timezone, now, daysAhead: AHEAD_DAYS, perWeek,
      days: rule?.limits.days, windows: rule?.limits.windows,
      taken: taken.filter((t) => t.brandId === brand.id).flatMap((t) => (t.at ? [t.at] : [])),
    });
    slots.forEach((at, i) => {
      const item = queue[i];
      if (!item) return;
      projected.push({
        ideaId: item.idea.id, title: item.idea.title || item.idea.problem, status: item.idea.status,
        brandId: brand.id, brandName: meta.name, brandColor: meta.color, at, writerOn: Boolean(agent?.enabled),
      });
    });
  }
  return { projected, waiting };
}
