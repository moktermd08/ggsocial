import { NextResponse } from "next/server";
import { runPageChecks } from "@/server/page-checks";

/**
 * Page check tick, hourly. Visits each channel's saved page URL once every
 * six hours and ticks every brand's "confirm each page is live" activity from
 * the results.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runPageChecks());
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
