import { z } from "zod";
import { can } from "@/lib/auth";
import { isDateKey, todayIn } from "@/lib/activities/periods";
import { reviewChecks } from "@/server/activities";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Review = z.object({
  brand: z.string().min(1),
  code: z.string().min(1),
  date: z.string().refine(isDateKey, "date must be YYYY-MM-DD").optional(),
  decision: z.enum(["approved", "rejected"]),
  /** Why it was rejected, or what was checked. Shown to whoever did the work. */
  note: z.string().max(4000).nullish(),
});
const Many = z.object({ reviews: z.array(Review).min(1).max(200) });

/**
 * Review recorded work — an agent acting as the second pair of eyes.
 *
 *   POST /api/agent/activities/reviews
 *   { "brand": "acme", "code": "W-13", "decision": "rejected", "note": "Only 1 request sent, target is 3." }
 *
 * A rejection shows up in the checklist as work to redo.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const json = await req.json().catch(() => null);
    const body = json && typeof json === "object" && "reviews" in json ? Many.safeParse(json) : Review.safeParse(json);
    if (!body.success) throw new AgentError(body.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const reviews = "reviews" in body.data ? body.data.reviews : [body.data];

    const reviewed = [];
    const skipped = [];
    for (const r of reviews) {
      for (const b of pickBrands(brands, r.brand)) {
        if (!can.approve(b.role) && !can.edit(b.role)) throw new AgentError(`Cannot review ${b.slug} as a ${b.role}.`, 403);
        const [result] = await reviewChecks(
          [{ brandId: b.id, code: r.code.toUpperCase(), date: r.date ?? todayIn(b.timezone) }],
          r.decision, r.note, { kind: "ai", name: agent.name, userId: agent.userId },
        );
        if (result.check) reviewed.push({ brand: b.slug, code: result.template.code, period: result.period.key, review: result.check.reviewStatus });
        else skipped.push({ brand: b.slug, code: result.template.code, reason: `Nothing recorded in ${result.period.label} yet.` });
      }
    }
    return { reviewed, skipped };
  });
}

export const dynamic = "force-dynamic";
