import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, activityChecks, agentRuns, brandAgents, brands, interactions, posts } from "@/lib/db";
import { AGENTS, AGENT_BY_CODE, agentActorName, type AgentCode } from "@/lib/agents/meta";
import { DraftingError, NOT_CONFIGURED, draftingConfigured } from "@/server/drafting";
import { runWriter } from "@/server/agents/writer";
import { runCommunity } from "@/server/agents/community";
import { analystDue, runAnalyst } from "@/server/agents/analyst";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

export type BrandAgent = typeof brandAgents.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;

const RUNNERS: Record<AgentCode, (job: AgentJob) => Promise<AgentOutcome>> = {
  writer: runWriter,
  community: runCommunity,
  analyst: runAnalyst,
};

/** Replies are on a clock, so the community manager goes first in every tick. */
const ORDER: AgentCode[] = ["community", "writer", "analyst"];

/** A run still "running" after this long died with its process. */
const STALE_MS = 15 * 60_000;

/** Every brand's crew settings, one row per agent that has ever been set up. */
export async function getCrew(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  return db.select().from(brandAgents).where(inArray(brandAgents.brandId, brandIds));
}

export async function getRuns(brandIds: string[], opts: { limit?: number; agentCode?: AgentCode } = {}) {
  if (brandIds.length === 0) return [];
  return db.select().from(agentRuns)
    .where(and(inArray(agentRuns.brandId, brandIds), opts.agentCode ? eq(agentRuns.agentCode, opts.agentCode) : undefined))
    .orderBy(desc(agentRuns.startedAt))
    .limit(opts.limit ?? 50);
}

/** The row for one brand's agent, created (switched off) the first time anyone touches it. */
export async function ensureBrandAgent(brandId: string, agentCode: AgentCode) {
  await db.insert(brandAgents).values({ brandId, agentCode }).onConflictDoNothing();
  return (await db.query.brandAgents.findFirst({
    where: and(eq(brandAgents.brandId, brandId), eq(brandAgents.agentCode, agentCode)),
  }))!;
}

async function execute(config: BrandAgent, opts: { trigger: "schedule" | "manual"; userId?: string | null; limit?: number; now: Date }) {
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, config.brandId) });
  if (!brand) throw new Error("Brand not found.");

  const [run] = await db.insert(agentRuns).values({
    brandId: brand.id, agentCode: config.agentCode, trigger: opts.trigger, triggeredBy: opts.userId ?? null, startedAt: opts.now,
  }).returning();

  try {
    const outcome = await RUNNERS[config.agentCode]({ brand, config, limit: opts.limit, now: opts.now });
    const worked = outcome.items.length > 0 || outcome.usage !== null;
    const [done] = await db.update(agentRuns).set({
      status: worked ? "succeeded" : "idle",
      summary: outcome.summary, items: outcome.items, issues: [...new Set(outcome.issues)], usage: outcome.usage,
      finishedAt: new Date(),
    }).where(eq(agentRuns.id, run.id)).returning();
    return done;
  } catch (err) {
    const message = err instanceof DraftingError || err instanceof Error ? err.message : "The run failed.";
    if (!(err instanceof DraftingError)) console.error(`[agents] ${config.agentCode} on ${brand.name} failed`, err);
    const [failed] = await db.update(agentRuns).set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(agentRuns.id, run.id)).returning();
    return failed;
  }
}

/**
 * "Run now" from the page. Refuses while a run of the same agent is still
 * going, so two clicks never write the same slot twice.
 */
export async function runAgentNow(brandId: string, agentCode: AgentCode, userId: string) {
  if (!draftingConfigured()) throw new Error(NOT_CONFIGURED);
  const config = await ensureBrandAgent(brandId, agentCode);
  const now = new Date();
  const busy = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.brandId, brandId), eq(agentRuns.agentCode, agentCode), eq(agentRuns.status, "running"),
      gte(agentRuns.startedAt, new Date(now.getTime() - STALE_MS))),
    columns: { id: true },
  });
  if (busy) throw new Error("This agent is already working on this brand. Give it a minute.");
  await db.update(brandAgents).set({ lastRunAt: now }).where(eq(brandAgents.id, config.id));
  // One item per click: the web request has to finish inside the proxy's timeout.
  return execute(config, { trigger: "manual", userId, limit: 1, now });
}

/**
 * The scheduled tick: every switched-on agent whose interval has passed gets
 * a run, most time-sensitive first, until the time budget is spent. Claiming
 * a row moves its lastRunAt forward in the same statement, so overlapping
 * ticks never run the same agent twice.
 */
export async function runDueAgents(now = new Date(), budgetMs = 180_000) {
  const started = Date.now();
  if (!draftingConfigured()) return { ran: [], skipped: NOT_CONFIGURED };

  // Runs whose process died are closed off, so the log never shows them running forever.
  await db.update(agentRuns).set({ status: "failed", error: "The run stopped without finishing.", finishedAt: now })
    .where(and(eq(agentRuns.status, "running"), lt(agentRuns.startedAt, new Date(now.getTime() - STALE_MS))));

  const rows = await db.select({ config: brandAgents, brand: brands }).from(brandAgents)
    .innerJoin(brands, eq(brands.id, brandAgents.brandId))
    .where(and(eq(brandAgents.enabled, true), isNull(brands.archivedAt)));
  rows.sort((a, b) => ORDER.indexOf(a.config.agentCode) - ORDER.indexOf(b.config.agentCode));

  const ran: { brand: string; agent: AgentCode; status: string; summary: string | null }[] = [];
  for (const { config, brand } of rows) {
    if (Date.now() - started > budgetMs) break;
    const def = AGENT_BY_CODE[config.agentCode];
    if (!def) continue;
    const cutoff = new Date(now.getTime() - def.everyMinutes * 60_000);
    if (config.lastRunAt && config.lastRunAt > cutoff) continue;
    if (config.agentCode === "analyst" && !(await analystDue(brand.id, brand.timezone, now))) continue;

    const claimed = await db.update(brandAgents).set({ lastRunAt: now })
      .where(and(eq(brandAgents.id, config.id), or(isNull(brandAgents.lastRunAt), lt(brandAgents.lastRunAt, cutoff))))
      .returning({ id: brandAgents.id });
    if (claimed.length === 0) continue;

    const run = await execute(config, { trigger: "schedule", now });
    ran.push({ brand: brand.name, agent: config.agentCode, status: run.status, summary: run.summary ?? run.error });
  }
  return { ran };
}


/** What the crew has left for people: the numbers on top of the Agents page. */
export async function getReviewCounts(brandIds: string[]) {
  if (brandIds.length === 0) return { posts: 0, replies: 0, checks: 0, failed: 0 };
  const since = new Date(Date.now() - 86_400_000);
  const [[p], [r], [c], [f]] = await Promise.all([
    db.select({ n: count() }).from(posts)
      .where(and(inArray(posts.brandId, brandIds), isNotNull(posts.agentCode), eq(posts.status, "in_review"))),
    db.select({ n: count() }).from(interactions)
      .where(and(inArray(interactions.brandId, brandIds), eq(interactions.agentCode, "community"), eq(interactions.status, "in_progress"))),
    db.select({ n: count() }).from(activityChecks)
      .where(and(inArray(activityChecks.brandId, brandIds), eq(activityChecks.doneByKind, "ai"),
        inArray(activityChecks.doneByName, AGENTS.map((a) => agentActorName(a.code))), isNull(activityChecks.reviewStatus))),
    db.select({ n: count() }).from(agentRuns)
      .where(and(inArray(agentRuns.brandId, brandIds), eq(agentRuns.status, "failed"), gte(agentRuns.startedAt, since))),
  ]);
  return { posts: p.n, replies: r.n, checks: c.n, failed: f.n };
}
