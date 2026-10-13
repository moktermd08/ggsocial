import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, workflowRuns } from "@/lib/db";
import type { AgentUsage } from "@/lib/agents/meta";
import { addUsage } from "@/server/agents/claude";
import { unusedIdeas } from "@/server/workflows/plan-ideas";
import { advance, startRun } from "@/server/workflows";
import { advanceCampaigns, campaignBrief, campaignGaps } from "@/server/campaign-plan";
import { weeklyVolume } from "@/server/volume";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The content strategist keeps the content plan ahead of the calendar. On
 * each run it first moves the brand's campaigns along by their dates, then
 * counts what is still needed against what the calendar will take:
 *
 *  - for each campaign that is running or about to start, the posts it asks
 *    for over the next weeks (or to its last day) against what is booked and
 *    waiting. The one ending soonest that falls short gets ideas of its own.
 *  - for the rest of the plan, as many posts a week as the brand's goals ask,
 *    less what the campaigns take.
 *
 * Only when something falls short does it start a "plan new ideas" run.
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

  // Campaigns move on their own dates whatever else is going on.
  const moved = await advanceCampaigns(brand, job.now);
  const notes = [
    moved.started.length ? `Started: ${moved.started.join(", ")}.` : "",
    moved.finished.length ? `Finished: ${moved.finished.join(", ")}.` : "",
  ].filter(Boolean);

  // One proposal at a time: a batch still waiting for review is the answer to "is the plan short".
  const open = await db.query.workflowRuns.findFirst({
    where: and(eq(workflowRuns.brandId, brand.id), eq(workflowRuns.workflowCode, "plan-ideas"),
      inArray(workflowRuns.status, ["running", "waiting", "waiting_review", "waiting_human"])),
  });
  if (open) {
    out.summary = [...notes, "New ideas are already waiting for review."].join(" ");
    return out;
  }

  const weeks = num(s.weeksAhead, 2, 1, 8);
  const volume = await weeklyVolume(brand.id, job.now);

  // Campaigns first: they have dates.
  const gaps = await campaignGaps(brand, job.now, weeks);
  const context: Record<string, unknown> = { guidelines: config.guidelines ?? null };
  let count = 0, label = "";
  let have = 0, need = 0;
  if (gaps.length) {
    const g = gaps[0];
    count = Math.min(num(s.perRun, 6, 1, 10), g.gap);
    context.campaign = { name: g.campaign.name, brief: campaignBrief(g.campaign), until: g.until };
    label = `campaign "${g.campaign.name}"`;
    have = g.have; need = g.wanted;
  } else {
    // The general plan is what the campaigns do not take.
    const perWeek = Math.max(1, volume.perWeek - volume.campaigns);
    need = perWeek * weeks;
    have = (await unusedIdeas(brand.id)).length;
    if (have >= need) {
      out.summary = [...notes, `The plan has ${have} idea${have === 1 ? "" : "s"} this brand has not told — enough for ${weeks} week${weeks === 1 ? "" : "s"} at ${perWeek} a week${volume.campaigns ? ` (the rest of its ${volume.perWeek} is for campaigns)` : ""}.`].join(" ");
      return out;
    }
    count = Math.min(num(s.perRun, 6, 1, 10), need - have);
    label = "the plan";
  }
  context.count = count;

  const run = await startRun({ brandId: brand.id, code: "plan-ideas", startedBy: "strategist", context });
  const report = await advance(run.id, { agentSteps: true, now: job.now });
  for (const step of report?.steps ?? []) {
    if (step.usage) out.usage = addUsage(out.usage, step.usage as AgentUsage);
    if (step.outcome === "failed") out.issues.push(step.summary);
  }
  const status = report?.run.status;
  out.items.push({
    kind: "note", id: null, href: status === "done" ? "/ideas" : "/review",
    label: report?.run.summary ?? `Proposed ideas for ${label}.`,
  });
  out.summary = [
    ...notes,
    `${label.charAt(0).toUpperCase()}${label.slice(1)} had ${have} idea${have === 1 ? "" : "s"} against ${need} needed over ${weeks} week${weeks === 1 ? "" : "s"}.`,
    status === "done" ? `Added ${count} new ones.` : status === "waiting_review" ? `Proposed ${count} new ones for review.` : report?.run.summary ?? "",
  ].filter(Boolean).join(" ");
  return out;
}
