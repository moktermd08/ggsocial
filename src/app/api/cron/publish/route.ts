import { NextResponse } from "next/server";
import { cronDenied } from "@/server/cron-auth";
import { runDuePublishes } from "@/server/publish";
import { stampLegacyApprovals } from "@/server/approval";

/**
 * Scheduler tick. Publishes everything that is due.
 *
 * Vercel Cron hits this with `Authorization: Bearer $CRON_SECRET` — see
 * vercel.json. Locally, run `npm run scheduler` in a second terminal.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;

  // Posts approved before approvals were fingerprinted are taken as approved in their current words.
  await stampLegacyApprovals().catch((err) => console.error("[cron/publish] could not stamp legacy approvals", err));
  const results = await runDuePublishes();
  return NextResponse.json({
    ran: results.length,
    published: results.filter((r) => r.ok && r.status === "published").length,
    queuedForManual: results.filter((r) => r.ok && r.status === "awaiting_manual").length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
