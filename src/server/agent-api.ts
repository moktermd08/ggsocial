import "server-only";
import { NextResponse } from "next/server";
import { getMyBrands, type BrandWithRole } from "@/lib/auth";
import { authenticateAgent } from "@/server/activities";

/**
 * Shared plumbing for /api/agent/*: who is calling, which brands they can
 * reach, and errors as JSON an agent can read and act on.
 */
export class AgentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type AgentContext = {
  agent: { tokenId: string; userId: string; name: string };
  brands: BrandWithRole[];
};

export async function withAgent(req: Request, handler: (ctx: AgentContext) => Promise<unknown>) {
  try {
    const agent = await authenticateAgent(req);
    if (!agent) throw new AgentError("Missing or revoked token. Send it as `Authorization: Bearer ggs_…` or `X-Agent-Token: ggs_…`.", 401);
    const brands = await getMyBrands(agent.userId);
    return NextResponse.json(await handler({ agent, brands }));
  } catch (e) {
    const status = e instanceof AgentError ? e.status : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Request failed." }, { status });
  }
}

/** "all", or a comma-separated list of brand ids or slugs. */
export function pickBrands(all: BrandWithRole[], ref: string | null | undefined) {
  if (!ref || ref === "all") return all;
  const wanted = ref.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const picked = all.filter((b) => wanted.includes(b.id.toLowerCase()) || wanted.includes(b.slug.toLowerCase()));
  const missing = wanted.filter((w) => !picked.some((b) => b.id.toLowerCase() === w || b.slug.toLowerCase() === w));
  if (missing.length) throw new AgentError(`Unknown brand: ${missing.join(", ")}. Use GET /api/agent/activities to list brands.`, 404);
  return picked;
}
