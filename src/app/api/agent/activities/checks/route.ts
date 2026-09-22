import { z } from "zod";
import { can } from "@/lib/auth";
import { CHECK_STATUSES } from "@/lib/activities/meta";
import { isDateKey, todayIn } from "@/lib/activities/periods";
import { clearChecks, recordChecks, type CheckInput } from "@/server/activities";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Check = z.object({
  /** A brand slug or id, several comma-separated, or "all" — one call can tick the same activity for every brand. */
  brand: z.string().min(1),
  code: z.string().min(1),
  date: z.string().refine(isDateKey, "date must be YYYY-MM-DD").optional(),
  status: z.enum(CHECK_STATUSES).default("done"),
  count: z.number().int().min(0).nullish(),
  proofUrl: z.string().url().nullish(),
  notes: z.string().max(4000).nullish(),
});
const Many = z.object({ checks: z.array(Check).min(1).max(200) });

function parse(json: unknown) {
  // Parsed against one shape or the other, not a union, so errors name the field that is wrong.
  const body = json && typeof json === "object" && "checks" in json ? Many.safeParse(json) : Check.safeParse(json);
  if (!body.success) throw new AgentError(body.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return "checks" in body.data ? body.data.checks : [body.data];
}

/**
 * Record work as done (or partly done, or skipped).
 *
 *   POST /api/agent/activities/checks
 *   { "brand": "all", "code": "D-02", "status": "done", "count": 14, "proofUrl": "https://…", "notes": "…" }
 *
 * or `{ "checks": [ … ] }` for several at once. The work is recorded as done by
 * the token's name (e.g. "Claude") and goes into the review queue.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const checks = parse(await req.json().catch(() => null));
    const inputs: (CheckInput & { slug: string })[] = [];
    for (const c of checks) {
      for (const b of pickBrands(brands, c.brand)) {
        if (!can.edit(b.role)) throw new AgentError(`The token's owner is a ${b.role} on ${b.slug} and cannot record work there.`, 403);
        inputs.push({
          slug: b.slug, brandId: b.id, code: c.code.toUpperCase(), date: c.date ?? todayIn(b.timezone),
          status: c.status, count: c.count, proofUrl: c.proofUrl, notes: c.notes,
        });
      }
    }
    const results = await recordChecks(inputs, { kind: "ai", name: agent.name, userId: agent.userId }, "api");
    return {
      recorded: results.map((r) => ({
        brand: (r.ref as (typeof inputs)[number]).slug, code: r.template.code, period: r.period.key, status: r.check.status,
      })),
    };
  });
}

/** DELETE with the same body shape (status ignored) undoes a check, back to "to do". */
export async function DELETE(req: Request) {
  return withAgent(req, async ({ brands }) => {
    const checks = parse(await req.json().catch(() => null));
    const refs = checks.flatMap((c) => pickBrands(brands, c.brand).map((b) => {
      if (!can.edit(b.role)) throw new AgentError(`Cannot change ${b.slug} as a ${b.role}.`, 403);
      return { brandId: b.id, code: c.code.toUpperCase(), date: c.date ?? todayIn(b.timezone) };
    }));
    return { cleared: await clearChecks(refs) };
  });
}

export const dynamic = "force-dynamic";
