import "server-only";
import { and, eq, gte, lte, ne, inArray } from "drizzle-orm";
import { db, brandAgents, posts } from "@/lib/db";
import { openSlots } from "@/lib/agents/slots";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { resolveSchedule } from "@/lib/posting-schedule";
import { parsePin } from "@/lib/pin";
import { getBrandPlaybooks } from "@/server/playbook";
import { weeklyVolume } from "@/server/volume";
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
  /** Pinned to this day by dragging, rather than forecast into the next open slot. */
  pinned: boolean;
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
    const { perWeek } = await weeklyVolume(brand.id, now);
    const push = (item: (typeof queue)[number], at: Date, pinned: boolean) => projected.push({
      ideaId: item.idea.id, title: item.idea.title || item.idea.problem, status: item.idea.status,
      brandId: brand.id, brandName: meta.name, brandColor: meta.color, at, pinned, writerOn: Boolean(agent?.enabled),
    });

    // Ideas a person pinned to a day go there, at the brand's usual time; a pin
    // that has passed no longer counts.
    const tomorrow = toLocalInput(new Date(now.getTime() + DAY), brand.timezone).slice(0, 10);
    const usual = resolveSchedule({ postRule: rule?.limits }).times[0];
    const pins = queue.filter((q) => { const pin = parsePin(q.idea.plannedFor); return pin && pin.day >= tomorrow; });
    const pinnedTimes: Date[] = [];
    for (const item of pins) {
      const pin = parsePin(item.idea.plannedFor)!;
      const at = fromLocalInput(`${pin.day}T${pin.time ?? usual}`, brand.timezone);
      if (!at) continue;
      pinnedTimes.push(at);
      push(item, at, true);
    }
    const free = queue.filter((q) => !pins.includes(q));

    const slots = openSlots({
      timezone: brand.timezone, now, daysAhead: AHEAD_DAYS, perWeek,
      days: rule?.limits.days, windows: rule?.limits.windows,
      taken: [...taken.filter((t) => t.brandId === brand.id).flatMap((t) => (t.at ? [t.at] : [])), ...pinnedTimes],
    });
    slots.forEach((at, i) => { if (free[i]) push(free[i], at, false); });
  }
  return { projected, waiting };
}
