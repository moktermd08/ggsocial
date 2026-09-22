import { getActivityTemplates } from "@/server/activities";
import { withAgent } from "@/server/agent-api";

/** GET /api/agent/activities/library — the master activity list every brand plan is built from. */
export async function GET(req: Request) {
  return withAgent(req, async () => {
    const templates = await getActivityTemplates();
    return {
      activities: templates.map((t) => ({
        code: t.code, title: t.title, description: t.description, category: t.category, frequency: t.frequency,
        platforms: t.platforms, target: t.target, unit: t.unit, proof: t.proof, performer: t.performer,
        leadImpact: t.leadImpact, estMinutes: t.estMinutes,
      })),
    };
  });
}

export const dynamic = "force-dynamic";
