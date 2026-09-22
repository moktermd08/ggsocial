import { NextResponse } from "next/server";
import { runGoalJobs } from "@/server/goals";

/**
 * Goals tick, hourly. Reads follower counts from live channels (once a day
 * each), re-plans every active goal on the first tick of each Monday in its
 * brand's timezone, and closes goals that have landed.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runGoalJobs());
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
