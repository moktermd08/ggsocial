import { GOAL_STATUSES, type GoalStatus } from "@/lib/goals/meta";
import { goalView } from "@/server/agent-goals";
import { getGoalState, getGoalsForBrands } from "@/server/goals";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

/**
 * Every goal on the brands the token can reach: where it stands, whether it
 * is on pace, this week's plan per activity and what to improve.
 *
 *   GET /api/agent/goals?brand=all&status=active
 *
 * `status` defaults to active; "all" includes paused, achieved and archived.
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const url = new URL(req.url);
    const picked = pickBrands(brands, url.searchParams.get("brand"));
    const status = url.searchParams.get("status") ?? "active";
    if (status !== "all" && !GOAL_STATUSES.includes(status as GoalStatus)) {
      throw new AgentError(`status must be one of: all, ${GOAL_STATUSES.join(", ")}.`);
    }
    const all = await getGoalsForBrands(picked.map((b) => b.id), { includeArchived: status === "all" || status === "archived" });
    const chosen = status === "all" ? all : all.filter((g) => g.status === status);
    const goals = await Promise.all(chosen.map(async (g) => {
      const brand = picked.find((b) => b.id === g.brandId)!;
      return goalView(g, brand, await getGoalState(g, brand, { history: false }));
    }));
    return { agent: agent.name, goals };
  });
}

export const dynamic = "force-dynamic";
