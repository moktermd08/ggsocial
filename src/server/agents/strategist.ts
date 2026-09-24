import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, workflowRuns } from "@/lib/db";
import type { AgentUsage } from "@/lib/agents/meta";
import type { EffectiveRule } from "@/lib/playbook/check";
import { getBrandPlaybook } from "@/server/playbook";
import { goalPostsPerWeek } from "@/server/agents/writer";
import { addUsage } from "@/server/agents/claude";
import { unusedIdeas } from "@/server/workflows/plan-ideas";
import { advance, startRun } from "@/server/workflows";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The content strategist keeps the content plan ahead of the calendar. On
 * each run it counts the ideas this brand could still tell against what the
 * next weeks need — as many posts a week as its goals ask for — and only when
 * the plan falls short does it start a "plan new ideas" run for the gap.
 * Counting costs nothing; only proposing calls Claude.
 */

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export async function runStrategist(job: AgentJob): Promise<AgentOutcome> {
  const { brand, config } = job;
  const s = config.settings ?? {};
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };

  // One proposal at a time: a batch still waiting for review is the answer to "is the plan short".
  const open = await db.query.workflowRuns.findFirst({
    where: and(eq(workflowRuns.brandId, brand.id), eq(workflowRuns.workflowCode, "plan-ideas"),
      inArray(workflowRuns.status, ["running", "waiting", "waiting_review", "waiting_human"])),
  });
  if (open) {
    out.summary = "New ideas are already waiting for review.";
    return out;
  }

  const weeks = num(s.weeksAhead, 2, 1, 8);
  const playbook = await getBrandPlaybook(brand.id);
  const postRule: EffectiveRule | undefined = playbook.find((r) => r.code === "post" && r.enabled);
  const perWeek = (await goalPostsPerWeek(brand.id)) ?? postRule?.limits.perWeek ?? 5;
  const need = perWeek * weeks;
  const have = (await unusedIdeas(brand.id)).length;
  if (have >= need) {
    out.summary = `The plan has ${have} idea${have === 1 ? "" : "s"} this brand has not told — enough for ${weeks} week${weeks === 1 ? "" : "s"} at ${perWeek} a week.`;
    return out;
  }

  const count = Math.min(num(s.perRun, 6, 1, 10), need - have);
  const run = await startRun({
    brandId: brand.id, code: "plan-ideas", startedBy: "strategist",
    context: { count, guidelines: config.guidelines ?? null },
  });
  const report = await advance(run.id, { agentSteps: true, now: job.now });
  for (const step of report?.steps ?? []) {
    if (step.usage) out.usage = addUsage(out.usage, step.usage as AgentUsage);
    if (step.outcome === "failed") out.issues.push(step.summary);
  }
  const status = report?.run.status;
  out.items.push({
    kind: "note", id: null, href: status === "done" ? "/ideas" : "/review",
    label: report?.run.summary ?? `Proposed ideas for the plan.`,
  });
  out.summary = [
    `The plan had ${have} unused idea${have === 1 ? "" : "s"} against ${need} needed for ${weeks} week${weeks === 1 ? "" : "s"}.`,
    status === "done" ? `Added ${count} new ones.` : status === "waiting_review" ? `Proposed ${count} new ones for review.` : report?.run.summary ?? "",
  ].filter(Boolean).join(" ");
  return out;
}
