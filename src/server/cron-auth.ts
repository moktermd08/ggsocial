import { NextResponse } from "next/server";

/**
 * The scheduled endpoints publish posts and spend AI budget, so they answer
 * only to the scheduler. In production a missing CRON_SECRET means they answer
 * to no one, rather than to anyone who finds the URL. Locally, with no secret
 * set, they stay open so `npm run scheduler` works out of the box.
 */
export function cronDenied(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron] CRON_SECRET is not set; refusing to run in production. Set it in the server's .env and in the scheduler's.");
      return NextResponse.json({ error: "CRON_SECRET is not configured on the server." }, { status: 503 });
    }
    return null;
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
