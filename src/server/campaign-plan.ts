import "server-only";
import { and, eq, gte, inArray, isNull, lt, ne, notInArray } from "drizzle-orm";
import { db, activity, campaigns, contentIdeas, interactions, metrics, posts, postTargets } from "@/lib/db";
import { DEFAULT_POSTS_PER_WEEK, dayInWindow, isBookable, isLive, statusFor } from "@/lib/campaign-window";
import { todayIn } from "@/lib/activities/periods";
import { fromLocalInput } from "@/lib/format";
import { sendAlert } from "@/server/alerts";
import { ideaVisibleToBrand as visibleTo } from "@/server/ideas";

/**
 * What a campaign does to the agents' work. A campaign is a brand's push with
 * dates, a message and targets; while it runs it asks for posts of its own, the
 * strategist plans ideas for it, the writer books them inside its dates, every
 * draft carries its brief, and its results are measured against its targets.
 */

export type Campaign = typeof campaigns.$inferSelect;
const DAY = 86_400_000;

export async function brandCampaigns(brandId: string) {
  return db.select().from(campaigns).where(and(eq(campaigns.brandId, brandId), isNull(campaigns.archivedAt)));
}

export async function campaignFor(brandId: string, name: string | null | undefined) {
  if (!name) return null;
  return (await brandCampaigns(brandId)).find((c) => c.name === name) ?? null;
}

const perWeekOf = (c: Campaign) => c.postsPerWeek && c.postsPerWeek > 0 ? c.postsPerWeek : DEFAULT_POSTS_PER_WEEK;

/** Posts a week the campaigns running today ask for. */
export async function campaignShare(brandId: string, today: string) {
  return (await brandCampaigns(brandId)).filter((c) => isLive(c, today)).reduce((n, c) => n + perWeekOf(c), 0);
}

/** What a writer is told about the campaign a post belongs to. */
export function campaignBrief(c: Campaign) {
  return [
    `Campaign: ${c.name}${c.startDate || c.endDate ? ` (${c.startDate ?? "now"} to ${c.endDate ?? "open-ended"})` : ""}`,
    c.objective ? `Objective: ${c.objective}` : "",
    c.keyMessage ? `The one message every post should land: ${c.keyMessage}` : "",
    c.audience ? `Audience: ${c.audience}` : "",
    c.cta ? `Call to action: ${c.cta}` : "",
    c.landingUrl ? `Send people to: ${c.landingUrl}` : "",
    c.hashtags.length ? `Campaign hashtags: ${c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}` : "",
  ].filter(Boolean).join("\n");
}

/* --------------------------------------------------------------- results */

export type Progress = {
  posts: number; published: number;
  impressions: number; clicks: number; leads: number;
  targets: { impressions: number | null; clicks: number | null; leads: number | null };
};

/** What the campaign has done so far: its posts, and their reach, clicks and leads, against its targets. */
export async function campaignProgress(brandId: string, c: Campaign): Promise<Progress> {
  const own = await db.select({ id: posts.id, status: posts.status }).from(posts)
    .where(and(eq(posts.brandId, brandId), eq(posts.campaign, c.name), ne(posts.status, "failed")));
  const published = own.filter((p) => p.status === "published" || p.status === "partially_published").length;
  let impressions = 0, clicks = 0, leads = 0;
  if (own.length) {
    const ts = await db.select({ id: postTargets.id }).from(postTargets)
      .where(and(inArray(postTargets.postId, own.map((p) => p.id)), eq(postTargets.status, "published"), isNull(postTargets.removedAt)));
    if (ts.length) {
      const readings = await db.select().from(metrics).where(inArray(metrics.targetId, ts.map((t) => t.id)));
      const latest = new Map<string, (typeof readings)[number]>();
      for (const m of readings) { const cur = latest.get(m.targetId); if (!cur || m.fetchedAt > cur.fetchedAt) latest.set(m.targetId, m); }
      for (const m of latest.values()) { impressions += m.impressions || m.reach; clicks += m.clicks; }
    }
    const found = await db.select({ id: interactions.id }).from(interactions)
      .where(and(inArray(interactions.postId, own.map((p) => p.id)), eq(interactions.kind, "lead")));
    leads = found.length;
  }
  return {
    posts: own.length, published, impressions, clicks, leads,
    targets: { impressions: c.targetImpressions, clicks: c.targetClicks, leads: c.targetLeads },
  };
}

export function progressLine(c: Campaign, p: Progress) {
  const part = (label: string, have: number, goal: number | null) => (goal ? `${label} ${have} of ${goal} (${Math.round((have / goal) * 100)}%)` : `${label} ${have}`);
  return `${c.name}: ${p.published} of ${p.posts} posts out; ${[part("impressions", p.impressions, p.targets.impressions), part("clicks", p.clicks, p.targets.clicks), part("leads", p.leads, p.targets.leads)].join(", ")}.`;
}

/* ------------------------------------------------------------- lifecycle */

/**
 * Moves campaigns along by their dates: planning → active on the start day,
 * active → done after the last day. When one finishes, the ideas made for it
 * that never got told are parked, and the brand's owners hear how it did.
 */
export async function advanceCampaigns(brand: { id: string; name: string; timezone: string }, now = new Date()) {
  const today = todayIn(brand.timezone, now);
  const started: string[] = [];
  const finished: string[] = [];
  for (const c of await brandCampaigns(brand.id)) {
    const next = statusFor(c, today);
    if (next === c.status) continue;
    await db.update(campaigns).set({ status: next, updatedAt: now }).where(eq(campaigns.id, c.id));
    await db.insert(activity).values({
      brandId: brand.id, actorId: null, action: `campaign.${next}`, entity: "campaign", entityId: c.id, meta: { name: c.name, from: c.status },
    });
    if (next === "active") started.push(c.name);
    if (next === "done") {
      finished.push(c.name);
      await db.update(contentIdeas).set({ status: "parked", updatedAt: now })
        .where(and(eq(contentIdeas.campaign, c.name), inArray(contentIdeas.status, ["planned", "backlog"]), visibleTo(brand.id)));
      await sendAlert({
        brandId: brand.id, kind: "campaign_finished", key: c.id, path: "/campaigns",
        subject: `Campaign "${c.name}" has finished`,
        lines: [progressLine(c, await campaignProgress(brand.id, c)), "Its unwritten ideas were parked."],
      });
    }
  }
  return { started, finished };
}


/* ----------------------------------------------------------------- needs */

export type CampaignGap = { campaign: Campaign; wanted: number; have: number; gap: number; until: string };

/**
 * Where the plan is short for the campaigns that can be told: the posts the
 * campaign wants over the next weeks (or to its end, if sooner) against the posts
 * already booked in that window plus the ideas waiting for it. Ending soonest first.
 */
export async function campaignGaps(brand: { id: string; timezone: string }, now: Date, weeksAhead: number): Promise<CampaignGap[]> {
  const today = todayIn(brand.timezone, now);
  // The last day looked at: a two-week horizon is fourteen days, today included.
  const horizon = todayIn(brand.timezone, new Date(now.getTime() + (weeksAhead * 7 - 1) * DAY));
  const out: CampaignGap[] = [];
  for (const c of (await brandCampaigns(brand.id)).filter((x) => isBookable(x, today))) {
    // Only look ahead as far as the start allows: a campaign starting in a month is not planned yet.
    if (c.startDate && c.startDate > horizon) continue;
    const from = c.startDate && c.startDate > today ? c.startDate : today;
    const until = c.endDate && c.endDate < horizon ? c.endDate : horizon;
    const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
    if (days <= 0) continue;
    const wanted = Math.max(1, Math.ceil((perWeekOf(c) * days) / 7));
    const start = fromLocalInput(`${from}T00:00`, brand.timezone);
    const end = fromLocalInput(`${until}T23:59`, brand.timezone);
    const booked = start && end
      ? (await db.select({ id: posts.id }).from(posts).where(and(
          eq(posts.brandId, brand.id), eq(posts.campaign, c.name), ne(posts.status, "failed"),
          gte(posts.scheduledAt, start), lt(posts.scheduledAt, new Date(end.getTime() + 60_000)),
        ))).length
      : 0;
    const waiting = (await db.select({ id: contentIdeas.id }).from(contentIdeas).where(and(
      eq(contentIdeas.campaign, c.name), isNull(contentIdeas.archivedAt), inArray(contentIdeas.status, ["planned", "backlog"]), visibleTo(brand.id),
      notInArray(contentIdeas.id, (await db.select({ id: posts.ideaId }).from(posts).where(and(eq(posts.brandId, brand.id), ne(posts.status, "failed")))).flatMap((r) => (r.id ? [r.id] : [])).concat(["-"])),
    ))).length;
    const have = booked + waiting;
    if (wanted > have) out.push({ campaign: c, wanted, have, gap: wanted - have, until });
  }
  return out.sort((a, b) => (a.until < b.until ? -1 : 1));
}

export { dayInWindow };
