import { can } from "@/lib/auth";
import { getGoal, recalibrateGoal } from "@/server/goals";
import { AgentError, withAgent } from "@/server/agent-api";

/**
 * Learn from the latest results and re-plan now, as the Monday job does.
 *
 *   POST /api/agent/goals/{id}/recalibrate
 *
 * Changes bigger than the goal's approval threshold come back as "proposed"
 * and wait for a person in the app; agents cannot approve them.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAgent(req, async ({ agent, brands }) => {
    const { id } = await params;
    const goal = await getGoal(id);
    const brand = goal && brands.find((b) => b.id === goal.brandId);
    if (!goal || !brand) throw new AgentError("No such goal on the brands this token can reach.", 404);
    if (!can.edit(brand.role)) throw new AgentError(`The token's owner is a ${brand.role} on ${brand.slug} and cannot re-plan its goals.`, 403);
    if (goal.status !== "active") throw new AgentError(`This goal is ${goal.status}; only active goals are re-planned.`, 409);
    const rev = await recalibrateGoal(goal.id, { userId: agent.userId });
    return {
      status: rev.status,
      summary: rev.summary,
      reasons: rev.reasons,
      perWeek: rev.after.plan.units,
      waitingForApproval: rev.status === "proposed",
    };
  });
}

export const dynamic = "force-dynamic";
