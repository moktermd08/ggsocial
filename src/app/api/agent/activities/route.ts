import { FREQUENCIES, type Frequency } from "@/lib/activities/meta";
import { isDateKey, todayIn } from "@/lib/activities/periods";
import { getChecklist } from "@/server/activities";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

/**
 * What is on the plan, and what is still open.
 *
 *   GET /api/agent/activities?frequency=daily&date=2026-09-22&brand=all&open=1
 *
 * `frequency` defaults to every frequency (the current period of each), `date`
 * to today in the first brand's timezone, `brand` to every brand the token can
 * reach (ids or slugs, comma-separated). `open=1` leaves out what is already done.
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const url = new URL(req.url);
    const picked = pickBrands(brands, url.searchParams.get("brand"));
    const f = url.searchParams.get("frequency");
    if (f && f !== "all" && !FREQUENCIES.includes(f as Frequency)) {
      throw new AgentError(`frequency must be one of: all, ${FREQUENCIES.join(", ")}.`);
    }
    const date = url.searchParams.get("date");
    if (date && !isDateKey(date)) throw new AgentError("date must be YYYY-MM-DD.");
    const onlyOpen = url.searchParams.get("open") === "1";

    const today = todayIn(picked[0]?.timezone ?? "UTC");
    const frequencies = !f || f === "all" ? [...FREQUENCIES] : [f as Frequency];

    const checklists = await Promise.all(frequencies.map(async (frequency) => {
      const list = await getChecklist({ brands: picked, frequency, date: date ?? today, today });
      return {
        frequency,
        period: { key: list.period.key, start: list.period.start, end: list.period.end, label: list.period.label, phase: list.phase },
        activities: list.rows.flatMap(({ template: t, cells }) => {
          const perBrand = cells
            .filter((c) => c.applies || c.check)
            .filter((c) => !onlyOpen || c.status === "open" || c.status === "missed" || c.check?.reviewStatus === "rejected")
            .map((c) => ({
              brand: picked.find((b) => b.id === c.brandId)!.slug,
              status: c.status,
              target: c.target,
              count: c.check?.count ?? null,
              proofUrl: c.check?.proofUrl ?? null,
              doneBy: c.check ? (c.check.doneByKind === "ai" ? c.check.doneByName : c.doneByUser ?? c.check.doneByName) : null,
              review: c.check?.reviewStatus ?? null,
              reviewNote: c.check?.reviewNote ?? null,
            }));
          if (perBrand.length === 0) return [];
          return [{
            code: t.code, title: t.title, description: t.description, category: t.category,
            platforms: t.platforms, unit: t.unit, proof: t.proof, performer: t.performer, leadImpact: t.leadImpact,
            brands: perBrand,
          }];
        }),
      };
    }));

    return {
      agent: agent.name,
      today,
      brands: picked.map((b) => ({ id: b.id, slug: b.slug, name: b.name, role: b.role, timezone: b.timezone })),
      checklists,
    };
  });
}

export const dynamic = "force-dynamic";
