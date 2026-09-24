import { NextResponse } from "next/server";
import { runDueAgents } from "@/server/agents";

/**
 * Brand agent tick, every few minutes. Each switched-on agent decides whether
 * it is due; one tick runs as many as fit in the time budget and leaves the
 * rest for the next.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDueAgents());
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
