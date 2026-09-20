import { NextResponse } from "next/server";
import { runDuePublishes } from "@/server/publish";

/**
 * Scheduler tick. Publishes everything that is due.
 *
 * Vercel Cron hits this with `Authorization: Bearer $CRON_SECRET` — see
 * vercel.json. Locally, run `npm run scheduler` in a second terminal.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
