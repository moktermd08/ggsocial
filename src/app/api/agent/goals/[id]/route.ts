import { GOAL_GRAINS, type GoalGrain } from "@/lib/goals/meta";
import { goalDetail } from "@/server/agent-goals";
import { getGoal } from "@/server/goals";
import { AgentError, withAgent } from "@/server/agent-api";

/**
 * One goal in full: the list view plus progress today / this week / month /
 * quarter / year, planned-against-actual history and the recent plan changes.
 *
 *   GET /api/agent/goals/{id}?grain=weekly
 *
 * `grain` (daily, weekly, monthly, quarterly, yearly) sets the history's periods.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async ({ brands }) => {
    const { id } = await params;
    const grain = new URL(req.url).searchParams.get("grain") ?? "weekly";
    if (!GOAL_GRAINS.includes(grain as GoalGrain)) throw new AgentError(`grain must be one of: ${GOAL_GRAINS.join(", ")}.`);
    const goal = await getGoal(id);
    const brand = goal && brands.find((b) => b.id === goal.brandId);
    if (!goal || !brand) throw new AgentError("No such goal on the brands this token can reach. List them with GET /api/agent/goals.", 404);
    return goalDetail(goal, brand, grain as GoalGrain);
  });
}

export const dynamic = "force-dynamic";
