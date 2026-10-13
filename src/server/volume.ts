import "server-only";
import { and, eq } from "drizzle-orm";
import { db, brandAgents, brands, goals } from "@/lib/db";
import { todayIn } from "@/lib/activities/periods";
import { getBrandPlaybook } from "@/server/playbook";
import { campaignShare } from "@/server/campaign-plan";

/**
 * How many posts a week a brand should be putting out. One answer, used by the
 * strategist (how many ideas the plan needs), the writer (how many slots to fill),
 * the calendar forecast and the weekly check, so they can never disagree.
 *
 * In order of say: a number a person set on the writer; otherwise what the
 * brand's goals ask for, else the playbook's feed-post rule, else five — and
 * on top of that, whatever the campaigns running right now need.
 */

/** Feed posts a week the brand's active goals ask for: the largest of their plans. null = no goal asks. */
export async function goalPostsPerWeek(brandId: string) {
  const active = await db.select({ plan: goals.plan }).from(goals)
    .where(and(eq(goals.brandId, brandId), eq(goals.status, "active")));
  const asks = active.map((g) => g.plan?.units?.["D-01"] ?? 0).filter((n) => n > 0);
  return asks.length ? Math.ceil(Math.max(...asks)) : null;
}

export type Volume = {
  perWeek: number;
  /** Before campaigns: from the writer's setting, the goals or the playbook. */
  base: number;
  /** Posts a week the running campaigns ask for. */
  campaigns: number;
  source: "setting" | "goals" | "playbook" | "default";
};

const clamp = (n: number) => Math.min(21, Math.max(1, Math.round(n)));

export async function weeklyVolume(brandId: string, now = new Date()): Promise<Volume> {
  const [agent, goalWeek, playbook, brand] = await Promise.all([
    db.query.brandAgents.findFirst({ where: and(eq(brandAgents.brandId, brandId), eq(brandAgents.agentCode, "writer")), columns: { settings: true } }),
    goalPostsPerWeek(brandId),
    getBrandPlaybook(brandId),
    db.query.brands.findFirst({ where: eq(brands.id, brandId), columns: { timezone: true } }),
  ]);
  const setting = Number(agent?.settings?.perWeek);
  const share = await campaignShare(brandId, todayIn(brand?.timezone ?? "UTC", now));
  // A number a person set is the total: they have already thought about campaigns.
  if (Number.isFinite(setting) && setting > 0) return { perWeek: clamp(setting), base: clamp(setting), campaigns: share, source: "setting" };

  const rule = playbook.find((r) => r.code === "post" && r.enabled)?.limits.perWeek;
  const base = goalWeek ?? rule ?? 5;
  const source = goalWeek ? "goals" : rule ? "playbook" : "default";
  // The campaign's posts are part of the week, not on top of it, but never crowd out the brand's usual voice.
  return { perWeek: clamp(share > 0 ? Math.max(base, share + 1) : base), base: clamp(base), campaigns: share, source };
}
