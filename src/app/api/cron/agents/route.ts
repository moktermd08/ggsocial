import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron-auth";
import { runDueAgents } from "@/server/agents";
import { runDueWorkflows } from "@/server/workflows";
import { pullInbound } from "@/server/inbox";
import { remindReviews } from "@/server/review-reminders";

/**
 * Brand agent tick, every few minutes. New comments are pulled in from every
 * connected channel first, so the community manager sees them this tick;
 * then every workflow run that is due moves on — a post someone approved gets
 * scheduled, a publish is watched — and each switched-on agent decides
 * whether it is due. One tick runs as much as fits in its time budget and
 * leaves the rest for the next.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const inbound = await pullInbound(new Date(), 45_000);
  const workflows = await runDueWorkflows(new Date(), 75_000);
  const agents = await runDueAgents(new Date(), 150_000);
  // Last, so a post the agents just wrote is counted. Quiet unless something has waited hours.
  const reminders = await remindReviews(new Date()).catch((err) => {
    console.error("[cron/agents] review reminders failed", err);
    return [];
  });
  return NextResponse.json({ inbound, workflows, reminders, ...agents });
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
