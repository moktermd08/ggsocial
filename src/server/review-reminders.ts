import "server-only";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, brands, posts, workflowRunSteps, workflowRuns } from "@/lib/db";
import { isCleanVerdict } from "@/lib/workflows/review";
import { WORKFLOW_BY_CODE } from "@/lib/workflows/meta";
import { sendAlert } from "@/server/alerts";
import { relativeTime, truncate } from "@/lib/format";

/**
 * Agents do the work; people only decide. When what they decide on sits
 * unanswered, the calendar quietly empties and the whole point is lost, so
 * once something has waited this long the brand's owners and admins get one
 * email saying what is waiting, what has a deadline, and what they can clear
 * in a click. Sent at most every 12 hours per brand (see alerts.ts).
 */
const REMIND_AFTER_MS = 3 * 60 * 60_000;
const DAY = 86_400_000;

export async function remindReviews(now = new Date()) {
  const open = await db.select({ step: workflowRunSteps, run: workflowRuns }).from(workflowRunSteps)
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowRunSteps.runId))
    .where(and(
      eq(workflowRunSteps.status, "paused"), isNull(workflowRunSteps.decision),
      inArray(workflowRuns.status, ["waiting_review", "waiting_human"]),
      lte(workflowRunSteps.createdAt, new Date(now.getTime() - REMIND_AFTER_MS)),
    ))
    .orderBy(asc(workflowRunSteps.createdAt));
  if (open.length === 0) return [];

  const byBrand = new Map<string, typeof open>();
  for (const row of open) byBrand.set(row.run.brandId, [...(byBrand.get(row.run.brandId) ?? []), row]);
  const brandRows = await db.select().from(brands).where(inArray(brands.id, [...byBrand.keys()]));

  const out: { brand: string; waiting: number; alert: string }[] = [];
  for (const brand of brandRows) {
    if (brand.archivedAt) continue;
    const items = byBrand.get(brand.id)!;
    const postIds = items.filter((i) => i.run.subjectType === "post" && i.run.subjectId).map((i) => i.run.subjectId!);
    const postRows = postIds.length ? await db.select().from(posts).where(inArray(posts.id, postIds)) : [];
    const postById = new Map(postRows.map((p) => [p.id, p]));

    const decisions = items.filter((i) => i.step.pause?.kind === "review").length;
    const stops = items.filter((i) => i.step.pause?.kind === "safety").length;
    const tasks = items.filter((i) => i.step.pause?.kind === "human").length;
    const clean = items.filter((i) => i.step.pause?.kind === "review" && isCleanVerdict(i.step.output?.review, brand.reviewThreshold)).length;
    const due = items.filter((i) => {
      const p = i.run.subjectId ? postById.get(i.run.subjectId) : undefined;
      return p?.scheduledAt && p.scheduledAt.getTime() <= now.getTime() + DAY;
    }).length;

    const parts = [
      decisions && `${decisions} to review`, stops && `${stops} safety stop${stops === 1 ? "" : "s"}`, tasks && `${tasks} task${tasks === 1 ? "" : "s"} only a person can do`,
    ].filter(Boolean);
    const lines = [
      `${items.length} thing${items.length === 1 ? " is" : "s are"} waiting for a person: ${parts.join(", ")}. The oldest has waited ${relativeTime(items[0].step.createdAt, now.getTime()).replace(/ ago$/, "")}.`,
      ...items.slice(0, 5).map((i) => {
        const p = i.run.subjectId ? postById.get(i.run.subjectId) : undefined;
        const what = p?.title || i.step.summary || WORKFLOW_BY_CODE[i.run.workflowCode]?.name || "Agent work";
        return `- ${truncate(what, 80)}: ${truncate(i.step.pause?.question ?? "Needs a decision.", 90)}`;
      }),
      items.length > 5 ? `…and ${items.length - 5} more.` : "",
      due ? `${due} of them ${due === 1 ? "is a post due" : "are posts due"} to go out within a day. Unapproved, its slot passes and the calendar goes quiet.` : "",
      clean ? `${clean} passed the reviewer cleanly. Open Review and approve them all in one click.` : "",
    ].filter(Boolean);

    const res = await sendAlert({
      brandId: brand.id, kind: "review_waiting", key: brand.id, path: "/review",
      subject: `${items.length} waiting for your review`, lines,
    });
    out.push({ brand: brand.name, waiting: items.length, alert: res });
  }
  return out;
}
