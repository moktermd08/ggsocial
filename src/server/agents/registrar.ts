import "server-only";
import { and, eq } from "drizzle-orm";
import { db, channels, workflowRuns } from "@/lib/db";
import { CATEGORY_ORDER } from "@/lib/platforms/types";
import { PLATFORM_LIST, hasPublicPage, platformOrNull } from "@/lib/platforms";
import { registeredPlatforms, registrationBlockers, removedPlatforms } from "@/lib/registration";
import { advance, startRun } from "@/server/workflows";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The brand registrar keeps the brand on every platform with the right
 * details. Each run it compares the platforms with the brand's channels:
 * where the brand is already registered it does nothing; where it is not, it
 * starts a "Register the brand on a platform" run. It never signs up itself
 * (a person does, in that workflow) and costs nothing: no model calls.
 */

const OPEN = ["running", "waiting", "waiting_review", "waiting_human"] as const;

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Platforms a brand can have a page on, most mainstream first, ones with a publishing API before manual ones. */
export const REGISTRABLE = PLATFORM_LIST
  .filter((p) => hasPublicPage(p.id))
  .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || Number(Boolean(a.manualOnly)) - Number(Boolean(b.manualOnly)));

export async function runRegistrar(job: AgentJob): Promise<AgentOutcome> {
  const { brand, config } = job;
  const s = config.settings ?? {};
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };

  const all = await db.select().from(channels).where(eq(channels.brandId, brand.id));
  const have = registeredPlatforms(all);
  const removed = removedPlatforms(all);

  // Registered channels that need a look: nothing is started for them.
  for (const c of all.filter((c) => !c.archivedAt && hasPublicPage(c.platform))) {
    const name = platformOrNull(c.platform)?.name ?? c.platform;
    if (!c.pageUrl) out.issues.push(`${name} (${c.handle}) has no page URL, so it cannot be audited.`);
    else if (c.pageStatus === "down") out.issues.push(`${name} (${c.handle}) page is down: ${c.pageNote ?? "unknown reason"}.`);
  }

  const runs = await db.select({ subjectId: workflowRuns.subjectId, status: workflowRuns.status }).from(workflowRuns)
    .where(and(eq(workflowRuns.brandId, brand.id), eq(workflowRuns.workflowCode, "register-platform")));
  // Any earlier run, finished or not, settles a platform: a rejected one is never asked again.
  const tried = new Set(runs.map((r) => r.subjectId));
  const open = runs.filter((r) => (OPEN as readonly string[]).includes(r.status)).length;

  const missing = REGISTRABLE.filter((p) => !have.has(p.id) && !removed.has(p.id) && !tried.has(`platform:${p.id}`));
  if (missing.length === 0) {
    out.summary = `Registered on every platform it should be on (${have.size}). Nothing to do.`;
    return out;
  }

  const blockers = registrationBlockers(brand, all);
  if (blockers.length) {
    out.issues.push(...blockers.map((i) => `Brand page, ${i.field}: ${i.message}`));
    out.summary = `${missing.length} platform${missing.length === 1 ? "" : "s"} still to register, on hold until the brand page passes its details check.`;
    return out;
  }

  const room = num(s.maxOpen, 5, 1, 20) - open;
  const take = Math.min(num(s.perRun, 3, 1, 10), job.limit ?? 10, Math.max(0, room));
  if (take === 0) {
    out.summary = `${missing.length} platform${missing.length === 1 ? "" : "s"} still to register; ${open} registration${open === 1 ? " is" : "s are"} already open, so none started.`;
    return out;
  }

  const started: string[] = [];
  for (const p of missing.slice(0, take)) {
    const run = await startRun({
      brandId: brand.id, code: "register-platform", startedBy: "registrar",
      subject: { type: "platform_registration", id: `platform:${p.id}` },
      context: { platform: p.id, guidelines: config.guidelines ?? null },
    });
    const report = await advance(run.id, { agentSteps: true, now: job.now });
    for (const step of report?.steps ?? []) if (step.outcome === "failed") out.issues.push(step.summary);
    started.push(p.name);
    out.items.push({
      kind: "note", id: run.id, href: report?.run.status === "waiting_review" ? "/review" : "/workflows",
      label: report?.run.summary ?? `Started registering on ${p.name}.`,
    });
  }
  out.summary = `Not yet on ${missing.length} platform${missing.length === 1 ? "" : "s"}. Started registration on ${started.join(", ")}.`;
  return out;
}
