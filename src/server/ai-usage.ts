import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, aiUsage, brands } from "@/lib/db";
import { costOf, formatUsd, type TokenUsage } from "@/lib/ai-cost";
import { fromLocalInput } from "@/lib/format";
import { todayIn } from "@/lib/activities/periods";

/**
 * The Claude spend ledger and each brand's daily budget. Every call is
 * recorded where it is made; agents and workflow steps check the budget
 * before they call. A person drafting in the composer is recorded but never
 * stopped — the budget is there to cap what runs unattended.
 */

type Brand = Pick<typeof brands.$inferSelect, "id" | "timezone" | "aiDailyBudget">;

export class BudgetError extends Error {}

export async function recordUsage(brandId: string, source: string, u: TokenUsage) {
  try {
    await db.insert(aiUsage).values({
      brandId, source, model: u.model,
      inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
      cost: costOf(u),
    });
  } catch (err) {
    // A ledger hiccup must never lose the work the call paid for.
    console.error("[ai-usage] could not record", err);
  }
}

/** Midnight at the start of today in the brand's timezone. */
function startOfDay(timezone: string, now: Date) {
  return fromLocalInput(`${todayIn(timezone, now)}T00:00`, timezone) ?? new Date(now.getTime() - 86_400_000);
}

export async function spentToday(brand: Pick<Brand, "id" | "timezone">, now = new Date()) {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${aiUsage.cost}), 0)` }).from(aiUsage)
    .where(and(eq(aiUsage.brandId, brand.id), gte(aiUsage.createdAt, startOfDay(brand.timezone, now))));
  return Number(row.total);
}

/** Today's spend for several brands at once, by brand id. */
export async function spendByBrand(list: Pick<Brand, "id" | "timezone">[], now = new Date()) {
  const out = new Map<string, number>();
  if (list.length === 0) return out;
  const earliest = new Date(Math.min(...list.map((b) => startOfDay(b.timezone, now).getTime())));
  const rows = await db.select({ brandId: aiUsage.brandId, cost: aiUsage.cost, at: aiUsage.createdAt }).from(aiUsage)
    .where(and(inArray(aiUsage.brandId, list.map((b) => b.id)), gte(aiUsage.createdAt, earliest)));
  for (const b of list) {
    const from = startOfDay(b.timezone, now);
    out.set(b.id, rows.filter((r) => r.brandId === b.id && r.at >= from).reduce((s, r) => s + r.cost, 0));
  }
  return out;
}

/** Throws BudgetError, in words an owner can act on, once today's budget is spent. */
export async function assertBudget(brand: Brand, now = new Date()) {
  const spent = await spentToday(brand, now);
  if (spent >= brand.aiDailyBudget) {
    throw new BudgetError(
      `Today's AI budget for this brand is spent (${formatUsd(spent)} of ${formatUsd(brand.aiDailyBudget)}). ` +
      "Agent work waits until tomorrow, or until the owner raises the budget in Workflows.",
    );
  }
  return spent;
}
