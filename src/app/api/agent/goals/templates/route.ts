import { METRIC_META } from "@/lib/goals/meta";
import { getGoalTemplates } from "@/server/goals";
import { withAgent } from "@/server/agent-api";

/** GET /api/agent/goals/templates — the master goal templates: which activities move each metric, and by how much. */
export async function GET(req: Request) {
  return withAgent(req, async () => {
    const templates = await getGoalTemplates();
    return {
      templates: templates.map((t) => ({
        code: t.code, name: t.name, metric: t.metric, kind: METRIC_META[t.metric].kind, description: t.description,
        howMeasured: METRIC_META[t.metric].how,
        activities: t.drivers.map((d) => ({
          code: d.activityCode, label: d.label, unit: d.unitLabel, benchmarkYield: d.yield,
          yieldPer: d.scale === "audience" ? "unit per 1,000 audience" : "unit", share: d.share, maxPerWeek: d.maxPerWeek,
        })),
      })),
    };
  });
}

export const dynamic = "force-dynamic";
