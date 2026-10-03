import "server-only";
import { and, count, countDistinct, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import {
  db, activityChecks, activityTemplates, brandActivitySettings, brands, channels, interactions, posts, postTargets,
} from "@/lib/db";
import { fromLocalInput } from "@/lib/format";
import { periodFor, todayIn } from "@/lib/activities/periods";
import type { CheckStatus } from "@/lib/activities/meta";
import type { EffectiveRule } from "@/lib/playbook/check";
import { ensureActivityLibrary, recordChecks, type CheckInput } from "@/server/activities";
import { getBrandPlaybook } from "@/server/playbook";
import { goalPostsPerWeek } from "@/server/agents/writer";

/**
 * Ticks the activity checklist from the work that actually happened: posts
 * published, replies sent, the inbox read, next week booked. Agents and
 * workflows do this work every day; without this the checklist would show it
 * as undone, and the goals — which learn what each activity is worth from the
 * checklist's counts — would never see it.
 *
 * Counts are worked out from the facts every time, so running it again only
 * corrects them. A check a person recorded is theirs and is never touched.
 */

const ACTOR = { kind: "ai" as const, name: "ggsocial, from the work done", userId: null };
const DAY = 86_400_000;
const VIDEO_PLATFORMS = ["youtube", "tiktok"];

type Brand = typeof brands.$inferSelect;
type Want = { code: string; date: string; status: CheckStatus; count: number; notes: string };

function dayBounds(date: string, timezone: string) {
  const start = fromLocalInput(`${date}T00:00`, timezone) ?? new Date(`${date}T00:00:00Z`);
  return { start, end: new Date(start.getTime() + DAY) };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** What one brand did on one day, and this week, as the checks it earns. */
async function factsFor(brand: Brand, date: string): Promise<Want[]> {
  const { start, end } = dayBounds(date, brand.timezone);
  const out: Want[] = [];

  // Published: one post can go to several channels; each format counts once per post.
  const published = await db.select({ postId: postTargets.postId, platform: channels.platform, options: postTargets.options })
    .from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(eq(posts.brandId, brand.id), eq(postTargets.status, "published"), gte(postTargets.publishedAt, start), lt(postTargets.publishedAt, end)));
  const byFormat = { feed: new Set<string>(), story: new Set<string>(), video: new Set<string>() };
  for (const p of published) {
    const format = String((p.options as Record<string, unknown>)?.format ?? "");
    if (format === "story") byFormat.story.add(p.postId);
    else if (format === "reel" || VIDEO_PLATFORMS.includes(p.platform)) byFormat.video.add(p.postId);
    else byFormat.feed.add(p.postId);
  }
  if (byFormat.feed.size) out.push({ code: "D-01", date, status: "done", count: byFormat.feed.size, notes: `${byFormat.feed.size} post${byFormat.feed.size === 1 ? "" : "s"} published.` });
  if (byFormat.story.size) out.push({ code: "D-17", date, status: "done", count: byFormat.story.size, notes: `${byFormat.story.size} stor${byFormat.story.size === 1 ? "y" : "ies"} published.` });
  if (byFormat.video.size) out.push({ code: "2D-01", date, status: "done", count: byFormat.video.size, notes: `${byFormat.video.size} short video${byFormat.video.size === 1 ? "" : "s"} published.` });

  // Answered: replies sent that day, by kind. "Every" one means nothing from that day is still waiting.
  const answered: [code: string, kinds: ("comment" | "reply" | "message" | "review")[], noun: string][] = [
    ["D-02", ["comment", "reply"], "comment"],
    ["D-03", ["message"], "message"],
    ["D-13", ["review"], "review"],
  ];
  for (const [code, kinds, noun] of answered) {
    const [{ n: replied }] = await db.select({ n: count() }).from(interactions).where(and(
      eq(interactions.brandId, brand.id), eq(interactions.direction, "inbound"), inArray(interactions.kind, kinds),
      eq(interactions.status, "replied"), gte(interactions.repliedAt, start), lt(interactions.repliedAt, end),
    ));
    if (!replied) continue;
    const [{ n: waiting }] = await db.select({ n: count() }).from(interactions).where(and(
      eq(interactions.brandId, brand.id), eq(interactions.direction, "inbound"), inArray(interactions.kind, kinds),
      inArray(interactions.status, ["new", "in_progress"]), lt(interactions.receivedAt, end),
    ));
    out.push({
      code, date, status: waiting ? "partial" : "done", count: replied,
      notes: `${replied} ${noun}${replied === 1 ? "" : "s"} answered.${waiting ? ` ${waiting} still waiting.` : ""}`,
    });
  }

  // The inbox read: every connected channel was checked for new comments that day.
  const live = await db.select({ id: channels.id, checked: channels.inboxCheckedAt }).from(channels)
    .where(and(eq(channels.brandId, brand.id), eq(channels.mode, "live"), isNull(channels.archivedAt)));
  if (live.length && live.every((c) => c.checked && c.checked >= start)) {
    const [{ n: arrived }] = await db.select({ n: count() }).from(interactions).where(and(
      eq(interactions.brandId, brand.id), eq(interactions.direction, "inbound"), gte(interactions.receivedAt, start), lt(interactions.receivedAt, end),
    ));
    out.push({ code: "D-10", date, status: "done", count: arrived, notes: `Every connected channel checked; ${arrived} new item${arrived === 1 ? "" : "s"} came in.` });
  }

  // Next week booked: this week's planning is done once next week has its posts.
  const week = periodFor("weekly", date);
  const nextFrom = dayBounds(addDays(week.end, 1), brand.timezone).start;
  const nextTo = dayBounds(addDays(week.end, 8), brand.timezone).start;
  const [{ n: booked }] = await db.select({ n: countDistinct(posts.id) }).from(posts).where(and(
    eq(posts.brandId, brand.id), inArray(posts.status, ["in_review", "approved", "scheduled", "published", "partially_published"]),
    gte(posts.scheduledAt, nextFrom), lt(posts.scheduledAt, nextTo),
  ));
  if (booked) {
    const playbook = await getBrandPlaybook(brand.id);
    const postRule: EffectiveRule | undefined = playbook.find((r) => r.code === "post" && r.enabled);
    const perWeek = (await goalPostsPerWeek(brand.id)) ?? postRule?.limits.perWeek ?? 5;
    out.push({
      code: "W-01", date, status: booked >= perWeek ? "done" : "partial", count: booked,
      notes: `${booked} of ${perWeek} posts booked for next week.`,
    });
  }

  // Connected channels healthy: the month's check, from what the sign-ins say today.
  const connectable = await db.select({ handle: channels.handle, status: channels.status, credentials: channels.credentials }).from(channels)
    .where(and(eq(channels.brandId, brand.id), isNull(channels.archivedAt), or(ne(channels.mode, "manual"), eq(channels.status, "expired"))));
  if (connectable.length) {
    const broken = connectable.filter((c) => c.status === "expired" || c.status === "error" || !c.credentials);
    out.push({
      code: "M-19", date, status: broken.length ? "partial" : "done", count: connectable.length - broken.length,
      notes: broken.length ? `Needs reconnecting: ${broken.map((c) => c.handle).join(", ")}.` : `All ${connectable.length} connected channels are signed in.`,
    });
  }
  return out;
}

/**
 * Brings the checklist in line with the work for today and yesterday (late
 * replies land on the day they were sent), for every brand or the ones given.
 */
export async function syncWorkChecks(now = new Date(), brandIds?: string[]) {
  await ensureActivityLibrary();
  const list = await db.select().from(brands).where(and(isNull(brands.archivedAt), brandIds?.length ? inArray(brands.id, brandIds) : undefined));
  const templates = await db.select().from(activityTemplates);
  const byCode = new Map(templates.map((t) => [t.code, t]));
  let written = 0;

  for (const brand of list) {
    const today = todayIn(brand.timezone, now);
    const wants = [...(await factsFor(brand, addDays(today, -1))), ...(await factsFor(brand, today))];
    if (wants.length === 0) continue;

    const ids = [...new Set(wants.map((w) => byCode.get(w.code)?.id).filter((x): x is string => Boolean(x)))];
    const [existing, off] = await Promise.all([
      db.select().from(activityChecks).where(and(eq(activityChecks.brandId, brand.id), inArray(activityChecks.templateId, ids))),
      db.select({ templateId: brandActivitySettings.templateId }).from(brandActivitySettings)
        .where(and(eq(brandActivitySettings.brandId, brand.id), eq(brandActivitySettings.enabled, false))),
    ]);
    const offIds = new Set(off.map((o) => o.templateId));

    const inputs: CheckInput[] = [];
    for (const w of wants) {
      const t = byCode.get(w.code);
      if (!t || offIds.has(t.id)) continue;
      const key = periodFor(t.frequency, w.date).key;
      const had = existing.find((c) => c.templateId === t.id && c.periodKey === key);
      // A person's record stands; an unchanged one is left as it is, review and all.
      if (had && (had.source !== "auto" || (had.status === w.status && had.count === w.count))) continue;
      inputs.push({ brandId: brand.id, code: w.code, date: w.date, status: w.status, count: w.count, notes: w.notes });
    }
    // Several days in one period (a weekly check from two days): the later day holds the full picture.
    if (inputs.length) written += (await recordChecks(inputs, ACTOR, "auto")).length;
  }
  return { brands: list.length, written };
}
