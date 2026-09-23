import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, playbookAdjustments, users } from "@/lib/db";
import { brandAdjustRights, canEditMaster, decideAdjustment } from "@/server/playbook";
import { AgentError, withAgent } from "@/server/agent-api";

const Decision = z.object({
  id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).nullish(),
});
const Many = z.object({ decisions: z.array(Decision).min(1).max(100) });

/**
 * Decide suggestions in the daily review — an agent as the second pair of
 * eyes. Only where the token's owner is an approver or admin on the brand (or
 * may edit the master); never your own suggestion.
 *
 *   POST /api/agent/playbook/adjustments/decisions
 *   { "id": "…", "decision": "approved" | "rejected", "note": "why" }
 *
 * or { "decisions": [ … ] }.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const json = await req.json().catch(() => null);
    const body = json && typeof json === "object" && "decisions" in json ? Many.safeParse(json) : Decision.safeParse(json);
    if (!body.success) throw new AgentError(body.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const list = "decisions" in body.data ? body.data.decisions : [body.data];
    const owner = await db.query.users.findFirst({ where: eq(users.id, agent.userId) });

    const decided = [];
    for (const d of list) {
      const adj = await db.query.playbookAdjustments.findFirst({ where: eq(playbookAdjustments.id, d.id) });
      if (!adj) throw new AgentError(`No suggestion ${d.id}.`, 404);
      // A second pair of eyes has to be a different pair.
      if (adj.actorKind === "ai" && adj.actorName === agent.name && adj.userId === agent.userId) {
        throw new AgentError(`Suggestion ${d.id} is this agent's own; someone else decides it.`, 403);
      }
      const brand = adj.brandId ? brands.find((b) => b.id === adj.brandId) : null;
      if (adj.brandId && !brand) throw new AgentError(`No suggestion ${d.id}.`, 404);
      const allowed = brand ? brandAdjustRights(brand.role).apply : Boolean(owner && await canEditMaster(owner));
      if (!allowed) throw new AgentError(`The token's owner cannot decide ${brand ? `${brand.slug}'s` : "master"} suggestions.`, 403);
      const row = await decideAdjustment(d.id, d.decision === "approved" ? "applied" : "rejected", d.note, {
        kind: "ai", name: agent.name, userId: agent.userId,
      });
      decided.push({ id: row.id, status: row.status });
    }
    return { decided };
  });
}

export const dynamic = "force-dynamic";
