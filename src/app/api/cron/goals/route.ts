import { NextResponse } from "next/server";
import { runGoalJobs } from "@/server/goals";
import { syncWorkChecks } from "@/server/work-checks";

/**
 * Goals tick, hourly. First the activity checklist catches up with the work
 * that actually happened — posts published, replies sent — since that is what
 * goals learn from. Then follower counts are read from live channels (once a
 * day each), every active goal is re-planned on the first tick of each Monday
 * in its brand's timezone, and goals that have landed are closed.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const checks = await syncWorkChecks();
  return NextResponse.json({ checks, ...(await runGoalJobs()) });
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
