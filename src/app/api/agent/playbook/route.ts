import { describeRule } from "@/lib/playbook/check";
import { getBrandPlaybooks, listAdjustments } from "@/server/playbook";
import { pickBrands, withAgent } from "@/server/agent-api";

/**
 * Each brand's playbook: for every format (post, reel, story…) and every kind
 * of engagement work (replies, DMs…), the limits that are checked, the points
 * to confirm, and how to do it well — with this brand's adjustments applied.
 *
 *   GET /api/agent/playbook?brand=all
 *
 * Follow these in everything you make or do for the brand. `summary` is the
 * limits as sentences; `limits` is the same as data for your own checks.
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ brands }) => {
    const picked = pickBrands(brands, new URL(req.url).searchParams.get("brand"));
    const [playbooks, open] = await Promise.all([
      getBrandPlaybooks(picked.map((b) => b.id)),
      listAdjustments({ brandIds: picked.map((b) => b.id), includeMaster: true, status: "proposed", limit: 500 }),
    ]);
    return {
      brands: picked.map((b) => ({
        slug: b.slug,
        name: b.name,
        timezone: b.timezone,
        openSuggestions: open.filter((o) => o.adjustment.brandId === b.id).length,
        rules: (playbooks.get(b.id) ?? []).filter((r) => r.enabled).map((r) => ({
          code: r.code,
          name: r.name,
          kind: r.kind,
          appliesWhen: r.description,
          platforms: r.platforms,
          activities: r.activityCodes,
          strictness: r.enforce,
          summary: describeRule(r),
          limits: r.limits,
          changedForThisBrand: r.customised,
          checklist: r.checklist.filter((i) => i.for !== "human").map((i) => ({ id: i.id, text: i.text })),
          instructions: [r.instructions, r.brandNotes].filter(Boolean).join("\n\n"),
        })),
      })),
      masterSuggestions: open.filter((o) => !o.adjustment.brandId).length,
    };
  });
}

export const dynamic = "force-dynamic";
