import { NextResponse } from "next/server";
import { runDueAgents } from "@/server/agents";
import { runDueWorkflows } from "@/server/workflows";

/**
 * Brand agent tick, every few minutes. First every workflow run that is due
 * moves on — a post someone approved gets scheduled, a publish is watched —
 * then each switched-on agent decides whether it is due. One tick runs as
 * many as fit in the time budget and leaves the rest for the next.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workflows = await runDueWorkflows(new Date(), 90_000);
  const agents = await runDueAgents(new Date(), 180_000);
  return NextResponse.json({ workflows, ...agents });
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
