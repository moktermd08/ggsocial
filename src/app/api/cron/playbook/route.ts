import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron-auth";
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
  const denied = cronDenied(req);
  if (denied) return denied;
  return NextResponse.json(await runPlaybookTuning());
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
