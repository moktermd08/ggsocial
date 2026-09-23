import { z } from "zod";
import { ADJUST_STATUSES, type AdjustStatus } from "@/lib/playbook/meta";
import { decodeValue } from "@/lib/playbook/check";
import { adjustRule, brandAdjustRights, canEditMaster, findRule, listAdjustments } from "@/server/playbook";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";
import { db, users } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * The daily review, for agents.
 *
 *   GET /api/agent/playbook/adjustments?status=proposed&brand=all
 *
 * Every suggested (or made) change to a playbook rule: the field, the value
 * before and after, the reason and the numbers behind it.
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ brands }) => {
    const url = new URL(req.url);
    const picked = pickBrands(brands, url.searchParams.get("brand"));
    const status = url.searchParams.get("status");
    if (status && !ADJUST_STATUSES.includes(status as AdjustStatus)) throw new AgentError(`status must be one of: ${ADJUST_STATUSES.join(", ")}.`);
    const rows = await listAdjustments({
      brandIds: picked.map((b) => b.id), includeMaster: true, status: (status as AdjustStatus) ?? undefined, limit: 200,
    });
    return {
      adjustments: rows.map(({ adjustment: a, rule }) => ({
        id: a.id,
        brand: a.brandId ? picked.find((b) => b.id === a.brandId)?.slug ?? a.brandId : "master",
        rule: rule.code,
        field: a.field,
        before: decodeValue(a.before),
        after: a.after === null ? "inherit" : decodeValue(a.after),
        reason: a.reason,
        evidence: a.evidence,
        status: a.status,
        source: a.source,
        by: a.actorName,
        createdAt: a.createdAt,
        decidedBy: a.decidedName,
        decisionNote: a.decisionNote,
      })),
    };
  });
}

const Adjust = z.object({
  /** A brand slug or id, or "master" for the rule every brand starts from. */
  brand: z.string().min(1),
  rule: z.string().min(1),
  field: z.string().min(1),
  value: z.unknown(),
  reason: z.string().min(10, "reason: say why, in a sentence — a person reads it in the daily review").max(2000),
  evidence: z.record(z.string(), z.unknown()).nullish(),
  /** Make the change now, where the token's owner may; otherwise it waits for the daily review. */
  apply: z.boolean().default(false),
});

/**
 * Suggest a change to a rule, or make it where the token's owner is an
 * approver or admin and "apply" is true.
 *
 *   POST /api/agent/playbook/adjustments
 *   { "brand": "acme", "rule": "reel", "field": "windows", "value": "18:00-21:00",
 *     "reason": "Last 12 reels after 18:00 averaged 2x the engagement of lunchtime ones." }
 *
 * `field` is a limit (titleMaxWords, hashtagsMin, hashtagsMax, bodyMinChars, bodyMaxChars, mediaKind, mediaMin,
 * mediaMax, aspectRatio, minWidth, minHeight, videoMinSeconds, videoMaxSeconds, windows, days, perWeek),
 * "enabled", "enforce" ("block" | "warn"), "instructions", or "checklist.add" with {"text": "…"}.
 * A brand limit's value "inherit" goes back to the master; null means no limit for this brand.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const parsed = Adjust.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const a = parsed.data;
    const rule = await findRule(a.rule);
    if (!rule) throw new AgentError(`Unknown rule "${a.rule}". GET /api/agent/playbook lists the codes.`, 404);

    let brandId: string | null = null;
    let mayApply: boolean;
    if (a.brand === "master") {
      const owner = await db.query.users.findFirst({ where: eq(users.id, agent.userId) });
      mayApply = Boolean(owner && await canEditMaster(owner));
    } else {
      const [b] = pickBrands(brands, a.brand);
      const rights = brandAdjustRights(b.role);
      if (!rights.propose) throw new AgentError(`The token's owner is a ${b.role} on ${b.slug} and cannot change its playbook.`, 403);
      brandId = b.id;
      mayApply = rights.apply;
    }

    const row = await adjustRule({
      rule, brandId, field: a.field, value: a.value, reason: a.reason, evidence: a.evidence ?? null,
      source: "agent", actor: { kind: "ai", name: agent.name, userId: agent.userId }, apply: a.apply && mayApply,
    });
    return {
      id: row.id,
      status: row.status,
      note: row.status === "proposed"
        ? (a.apply ? "Saved as a suggestion: the token's owner cannot change this directly. It waits for the daily review." : "Waiting for the daily review.")
        : "Applied.",
    };
  });
}

export const dynamic = "force-dynamic";
