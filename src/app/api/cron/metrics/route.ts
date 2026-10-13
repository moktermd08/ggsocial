import { NextResponse } from "next/server";
import { and, eq, gte, isNull } from "drizzle-orm";
import { cronDenied } from "@/server/cron-auth";
import { refreshDueMetrics } from "@/server/publish";
import { refreshLearnings } from "@/server/performance";
import { db, brands, posts, postTargets } from "@/lib/db";

/**
 * Reads the numbers of published posts as they come due (an hour, six hours, a
 * day, two days… after posting), then refreshes the lessons of every brand
 * that was just read. Runs on its own clock, so the numbers keep coming
 * whether or not the analyst agent is switched on.
 *
 * Same auth as the publish tick: `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;

  const now = new Date();
  const report = await refreshDueMetrics(now, { budgetMs: 40_000 });

  const touched = await db.selectDistinct({ id: brands.id, timezone: brands.timezone }).from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(brands, eq(brands.id, posts.brandId))
    .where(and(isNull(brands.archivedAt), eq(postTargets.status, "published"), gte(postTargets.metricsCheckedAt, new Date(now.getTime() - 35 * 60_000))));
  let lessons = 0;
  for (const b of touched) lessons += (await refreshLearnings(b, now)).length;

  return NextResponse.json({ ...report, brandsRelearned: touched.length, lessons });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
