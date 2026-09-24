"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, activity, brandAgents, channels } from "@/lib/db";
import { requireBrandRole, can } from "@/lib/auth";
import { AGENT_BY_CODE, isAgentCode, type AgentCode } from "@/lib/agents/meta";
import { ensureBrandAgent, runAgentNow } from "@/server/agents";

/** Keeps only the settings the agent defines, each in range. */
async function cleanSettings(brandId: string, code: AgentCode, raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of AGENT_BY_CODE[code].settings) {
    const v = raw[f.key];
    if (f.type === "number") {
      if (v === null || v === undefined || v === "") continue;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) throw new Error(`${f.label} must be a number.`);
      out[f.key] = Math.min(f.max ?? n, Math.max(f.min ?? n, n));
    } else if (f.type === "channels") {
      const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      if (ids.length === 0) continue;
      const mine = await db.select({ id: channels.id }).from(channels)
        .where(and(eq(channels.brandId, brandId), isNull(channels.archivedAt)));
      out[f.key] = ids.filter((id) => mine.some((c) => c.id === id));
    }
  }
  return out;
}

/**
 * Switches a brand's agent on or off, and saves its guidelines and settings.
 * Brand admins only: the crew acts in the brand's name every hour.
 */
export async function saveBrandAgentAction(input: {
  brandId: string;
  agentCode: string;
  enabled?: boolean;
  guidelines?: string | null;
  settings?: Record<string, unknown>;
}) {
  return asResult(async () => {
    if (!isAgentCode(input.agentCode)) throw new Error("Unknown agent.");
    const { user, role } = await requireBrandRole(input.brandId, "viewer");
    if (!can.manageBrand(role)) throw new Error("Only brand admins can set up agents.");

    const row = await ensureBrandAgent(input.brandId, input.agentCode);
    const patch: Partial<typeof brandAgents.$inferInsert> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.guidelines !== undefined) patch.guidelines = input.guidelines?.trim() || null;
    if (input.settings !== undefined) patch.settings = await cleanSettings(input.brandId, input.agentCode, input.settings);
    await db.update(brandAgents).set(patch).where(eq(brandAgents.id, row.id));

    if (input.enabled !== undefined && input.enabled !== row.enabled) {
      await db.insert(activity).values({
        brandId: input.brandId, actorId: user.id, action: input.enabled ? "agent.enabled" : "agent.disabled",
        entity: "agent", entityId: row.id, meta: { agent: input.agentCode },
      });
    }
    revalidatePath("/agents");
  });
}

/** One run, now, capped at one item so it finishes inside the web request. */
export async function runAgentNowAction(brandId: string, agentCode: string) {
  return asResult(async () => {
    if (!isAgentCode(agentCode)) throw new Error("Unknown agent.");
    const { user, role } = await requireBrandRole(brandId, "viewer");
    if (!can.edit(role)) throw new Error("You need editor access to run agents.");
    const run = await runAgentNow(brandId, agentCode, user.id);
    revalidatePath("/agents");
    revalidatePath("/", "layout");
    if (run.status === "failed") throw new Error(run.error ?? "The run failed.");
    return { summary: run.summary ?? "" };
  });
}
