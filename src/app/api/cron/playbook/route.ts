import { NextResponse } from "next/server";
import { runPlaybookTuning } from "@/server/playbook";

/**
 * Playbook tuning, hourly. Reads what each brand published in each format and
 * when, and suggests posting windows where the numbers clearly favour other
 * hours. It never changes a rule: suggestions wait in the daily review.
 * Idempotent — an open or recently rejected suggestion is not made twice.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runPlaybookTuning());
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
