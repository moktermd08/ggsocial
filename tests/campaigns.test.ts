import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());
const alerts = vi.hoisted(() => ({ sendAlert: vi.fn(async () => "sent") }));
vi.mock("@/server/alerts", () => alerts);
const claude = vi.hoisted(() => ({ tasks: [] as { source: string; task: string }[] }));
vi.mock("@/server/agents/claude", () => ({
  askClaude: async (o: { task: string; source: string }) => {
    claude.tasks.push({ source: o.source, task: o.task });
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, model: "m" };
    if (o.source.startsWith("review:")) return { output: { score: 92, flags: [], summary: "fine", fixes: [] }, usage };
    const n = Number(/Propose (\d+)/.exec(o.task)?.[1] ?? 1);
    return {
      output: { ideas: Array.from({ length: n }, (_, i) => ({ title: `Camp idea ${i + 1} ${Math.random().toString(36).slice(2, 6)}`, pillar: "Offers", problem: "p", action: "a", outcome: "o", postType: "Hook", tone: "plain", needsMedia: false, hashtags: [], why: "w" })) },
      usage,
    };
  },
  addUsage: (a: unknown) => a,
}));
vi.mock("@/server/research", () => ({ fetchSignals: async () => [], researchQueries: () => [], signalsBlock: () => "" }));

import { db, users, brands, memberships, campaigns, contentIdeas, posts, brandAgents, metrics, postTargets, channels, interactions, workflowRuns } from "@/lib/db";
import { DEFAULT_POSTS_PER_WEEK, dayInWindow, isBookable, isLive, statusFor } from "@/lib/campaign-window";
import { ideaAudience, ideaIsFor } from "@/lib/idea-scope";
import { advanceCampaigns, campaignBrief, campaignFor, campaignGaps, campaignProgress, campaignShare } from "@/server/campaign-plan";
import { weeklyVolume } from "@/server/volume";
import { ideaForBrand, unbookedIdeas } from "@/server/ideas";
import { unusedIdeas } from "@/server/workflows/plan-ideas";
import { runStrategist } from "@/server/agents/strategist";
import { decide, getOpenPauses } from "@/server/workflows";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("when a campaign can be told", () => {
  const c = (over: Partial<Parameters<typeof isBookable>[0]> = {}) => ({ status: "active" as const, startDate: null, endDate: null, ...over });
  it("is bookable while active or scheduled to start, and not once over or paused", () => {
    expect(isBookable(c(), "2026-10-14")).toBe(true);
    expect(isBookable(c({ status: "paused" }), "2026-10-14")).toBe(false);
    expect(isBookable(c({ status: "done" }), "2026-10-14")).toBe(false);
    expect(isBookable(c({ endDate: "2026-10-13" }), "2026-10-14")).toBe(false);
    expect(isBookable(c({ endDate: "2026-10-14" }), "2026-10-14")).toBe(true);
  });
  it("holds a campaign still being planned until it has a start date", () => {
    expect(isBookable(c({ status: "planning" }), "2026-10-14")).toBe(false);
    expect(isBookable(c({ status: "planning", startDate: "2026-11-01" }), "2026-10-14")).toBe(true);
    expect(isLive(c({ status: "planning", startDate: "2026-11-01" }), "2026-10-14")).toBe(false);
  });
  it("keeps posts inside its dates", () => {
    const w = c({ startDate: "2026-10-10", endDate: "2026-10-20" });
    expect(dayInWindow(w, "2026-10-09")).toBe(false);
    expect(dayInWindow(w, "2026-10-10")).toBe(true);
    expect(dayInWindow(w, "2026-10-21")).toBe(false);
  });
  it("moves its status along by the dates", () => {
    expect(statusFor(c({ status: "planning", startDate: "2026-10-14" }), "2026-10-14")).toBe("active");
    expect(statusFor(c({ endDate: "2026-10-13" }), "2026-10-14")).toBe("done");
    expect(statusFor(c({ status: "paused", endDate: "2026-10-13" }), "2026-10-14")).toBe("paused");
  });
});

describe("who an idea is for", () => {
  it("is open to every brand until it is aimed", () => {
    expect(ideaIsFor({ brandIds: null }, "b1")).toBe(true);
    expect(ideaIsFor({ brandIds: ["b1"] }, "b1")).toBe(true);
    expect(ideaIsFor({ brandIds: ["b1"] }, "b2")).toBe(false);
  });
  it("reaches the brands its author runs, or the ones it is aimed at", () => {
    expect(ideaAudience({ brandIds: null }, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(ideaAudience({ brandIds: ["b", "x"] }, ["a", "b", "c"])).toEqual(["b"]);
  });
});

let seq = 0;
async function world() {
  const n = ++seq;
  const [user] = await db.insert(users).values({ email: `c${n}@t.test`, name: "U", passwordHash: "x" }).returning();
  const mk = async (name: string) => {
    const [b] = await db.insert(brands).values({ name: `${name}${n}`, slug: `${name}${n}-camp`, timezone: "UTC" }).returning();
    await db.insert(memberships).values({ userId: user.id, brandId: b.id, role: "owner" });
    return b;
  };
  return { user, a: await mk("Clinic"), b: await mk("Bakery") };
}
const idea = async (userId: string, over: Partial<typeof contentIdeas.$inferInsert> = {}) =>
  (await db.insert(contentIdeas).values({ ownerId: userId, sequence: ++seq, problem: "p", title: `idea ${seq}`, status: "planned", ...over }).returning())[0];
const campaign = async (brandId: string, userId: string, over: Partial<typeof campaigns.$inferInsert> = {}) =>
  (await db.insert(campaigns).values({ brandId, ownerId: userId, name: `Camp ${++seq}`, status: "active", ...over }).returning())[0];

beforeEach(() => { alerts.sendAlert.mockClear(); claude.tasks.length = 0; });

describe("an idea aimed at one brand", () => {
  it("is not told by the others", async () => {
    const w = await world();
    const mine = await idea(w.user.id, { brandIds: [w.a.id] });
    const shared = await idea(w.user.id);
    expect((await ideaForBrand(mine.id, w.a.id))!.skipped).toBe(false);
    expect((await ideaForBrand(mine.id, w.b.id))!.skipped).toBe(true);
    expect((await ideaForBrand(shared.id, w.b.id))!.skipped).toBe(false);
  });

  it("shows up as waiting only for its own brand", async () => {
    const w = await world();
    const mine = await idea(w.user.id, { brandIds: [w.a.id] });
    const waiting = await unbookedIdeas(w.user.id, [w.a.id, w.b.id], [w.a.id, w.b.id]);
    expect(waiting.find((x) => x.idea.id === mine.id)!.missing.map((m) => m.id)).toEqual([w.a.id]);
  });

  it("counts only toward its own brand's plan", async () => {
    const w = await world();
    await idea(w.user.id, { brandIds: [w.a.id] });
    await idea(w.user.id, { brandIds: [w.b.id] });
    expect((await unusedIdeas(w.a.id)).length).toBe(1);
    expect((await unusedIdeas(w.b.id)).length).toBe(1);
  });

  it("keeps campaign ideas out of the general plan", async () => {
    const w = await world();
    await idea(w.user.id, { brandIds: [w.a.id] });
    await idea(w.user.id, { brandIds: [w.a.id], campaign: "Launch" });
    expect((await unusedIdeas(w.a.id)).length).toBe(1);
    expect((await unusedIdeas(w.a.id, { campaign: "Launch" })).length).toBe(1);
    expect((await unusedIdeas(w.a.id, { campaign: "any" })).length).toBe(2);
  });
});

describe("how many posts a week", () => {
  it("is the playbook's number, or five", async () => {
    const w = await world();
    const v = await weeklyVolume(w.a.id);
    expect(v.perWeek).toBeGreaterThanOrEqual(1);
    expect(v.campaigns).toBe(0);
  });

  it("adds what a running campaign asks for, but only while it runs", async () => {
    const w = await world();
    const base = (await weeklyVolume(w.a.id)).base;
    await campaign(w.a.id, w.user.id, { postsPerWeek: 9, startDate: day(-1), endDate: day(10) });
    await campaign(w.a.id, w.user.id, { postsPerWeek: 20, status: "paused" });
    await campaign(w.a.id, w.user.id, { postsPerWeek: 20, startDate: day(-30), endDate: day(-2) });
    const v = await weeklyVolume(w.a.id);
    expect(v.campaigns).toBe(9);
    expect(v.perWeek).toBe(Math.max(base, 10));
    expect(await campaignShare(w.b.id, day(0))).toBe(0);
  });

  it("is a person's number when they set one", async () => {
    const w = await world();
    await db.insert(brandAgents).values({ brandId: w.a.id, agentCode: "writer", settings: { perWeek: 14 } });
    await campaign(w.a.id, w.user.id, { postsPerWeek: 2, startDate: day(-1) });
    expect(await weeklyVolume(w.a.id)).toMatchObject({ perWeek: 14, source: "setting" });
  });
});

describe("a campaign's life", () => {
  it("starts on its start day and finishes after its last, parking what was never told", async () => {
    const w = await world();
    const starting = await campaign(w.a.id, w.user.id, { status: "planning", startDate: day(0) });
    const ending = await campaign(w.a.id, w.user.id, { name: "Ending", endDate: day(-1) });
    const left = await idea(w.user.id, { brandIds: [w.a.id], campaign: "Ending" });
    const other = await idea(w.user.id, { brandIds: [w.a.id] });
    const res = await advanceCampaigns(w.a);
    expect(res.started).toEqual([starting.name]);
    expect(res.finished).toEqual(["Ending"]);
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, starting.id) }))!.status).toBe("active");
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, ending.id) }))!.status).toBe("done");
    expect((await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, left.id) }))!.status).toBe("parked");
    expect((await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, other.id) }))!.status).toBe("planned");
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "campaign_finished", brandId: w.a.id }));
    // Nothing more to do the next time.
    expect(await advanceCampaigns(w.a)).toEqual({ started: [], finished: [] });
  });

  it("states the brief for a writer", async () => {
    const w = await world();
    const c = await campaign(w.a.id, w.user.id, { keyMessage: "Fewer no-shows", cta: "Book a demo", landingUrl: "https://x.test/demo", hashtags: ["launch"], startDate: "2026-11-01", endDate: "2026-11-30" });
    const brief = campaignBrief(c);
    expect(brief).toContain("Fewer no-shows");
    expect(brief).toContain("Book a demo");
    expect(brief).toContain("https://x.test/demo");
    expect(brief).toContain("#launch");
    expect(brief).toContain("2026-11-01 to 2026-11-30");
    expect((await campaignFor(w.a.id, c.name))!.id).toBe(c.id);
    expect(await campaignFor(w.b.id, c.name)).toBeNull();
  });
});

describe("what a campaign still needs", () => {
  it("wants its weekly posts over the next weeks, less what is booked or waiting", async () => {
    const w = await world();
    const c = await campaign(w.a.id, w.user.id, { postsPerWeek: 3, startDate: day(-3) });
    const none = await campaignGaps(w.a, new Date(), 2);
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ wanted: 6, have: 0, gap: 6 });

    await idea(w.user.id, { brandIds: [w.a.id], campaign: c.name });
    await idea(w.user.id, { brandIds: [w.a.id], campaign: c.name });
    await db.insert(posts).values({ brandId: w.a.id, title: "booked", body: "b", campaign: c.name, status: "scheduled", scheduledAt: new Date(Date.now() + 2 * 86_400_000) });
    expect((await campaignGaps(w.a, new Date(), 2))[0]).toMatchObject({ wanted: 6, have: 3, gap: 3 });
  });

  it("only looks as far ahead as the campaign lasts", async () => {
    const w = await world();
    await campaign(w.a.id, w.user.id, { postsPerWeek: 7, startDate: day(-1), endDate: day(2) });
    const g = await campaignGaps(w.a, new Date(), 4);
    // Yesterday to day after tomorrow, but only from today: three days at seven a week.
    expect(g[0].wanted).toBe(3);
  });

  it("ignores paused, finished and far-off campaigns", async () => {
    const w = await world();
    await campaign(w.a.id, w.user.id, { status: "paused" });
    await campaign(w.a.id, w.user.id, { endDate: day(-5) });
    await campaign(w.a.id, w.user.id, { status: "planning", startDate: day(60) });
    expect(await campaignGaps(w.a, new Date(), 2)).toEqual([]);
  });

  it("counts a campaign's results against its targets", async () => {
    const w = await world();
    const c = await campaign(w.a.id, w.user.id, { targetImpressions: 1000, targetClicks: 20, targetLeads: 2 });
    const [chan] = await db.insert(channels).values({ brandId: w.a.id, platform: "bluesky", handle: "h", mode: "live" }).returning();
    const [post] = await db.insert(posts).values({ brandId: w.a.id, title: "p", body: "b", campaign: c.name, status: "published" }).returning();
    const [t] = await db.insert(postTargets).values({ postId: post.id, channelId: chan.id, status: "published", publishedAt: new Date() }).returning();
    await db.insert(metrics).values({ targetId: t.id, impressions: 400, reach: 300, clicks: 7, fetchedAt: new Date(Date.now() - 3600_000) });
    await db.insert(metrics).values({ targetId: t.id, impressions: 600, reach: 500, clicks: 9 });
    await db.insert(interactions).values({ brandId: w.a.id, postId: post.id, kind: "lead", direction: "inbound", status: "new", body: "call me", receivedAt: new Date() } as never);
    expect(await campaignProgress(w.a.id, c)).toMatchObject({ posts: 1, published: 1, impressions: 600, clicks: 9, leads: 1, targets: { impressions: 1000, clicks: 20, leads: 2 } });
  });
  it("defaults to three a week", () => { expect(DEFAULT_POSTS_PER_WEEK).toBe(3); });
});

describe("the strategist and a campaign", () => {
  it("plans ideas for a campaign that falls short, aimed at its brand and tagged with it", async () => {
    const w = await world();
    const c = await campaign(w.a.id, w.user.id, { name: "Spring push", keyMessage: "Fewer no-shows", postsPerWeek: 2, startDate: day(-1), endDate: day(20) });
    const [cfg] = await db.insert(brandAgents).values({ brandId: w.a.id, agentCode: "strategist", enabled: true }).returning();
    const out = await runStrategist({ brand: w.a, config: cfg, now: new Date() } as never);
    expect(out.summary).toContain('Campaign "Spring push"');
    const proposal = claude.tasks.find((t) => t.source === "workflow:plan-ideas")!;
    expect(proposal.task).toContain("for a campaign");
    expect(proposal.task).toContain("Fewer no-shows");

    // The batch waits for a person; once approved the ideas are in the plan, aimed at this brand and tagged.
    const [pause] = await getOpenPauses([w.a.id]);
    await decide({ stepId: pause.step.id, decision: "approve", note: null, userId: w.user.id });
    const added = await db.select().from(contentIdeas).where(eq(contentIdeas.campaign, "Spring push"));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((i) => i.brandIds?.length === 1 && i.brandIds[0] === w.a.id)).toBe(true);
    expect(added.length).toBeLessThanOrEqual(4);
    // And not for the other brand.
    expect((await ideaForBrand(added[0].id, w.b.id))!.skipped).toBe(true);
    expect(c.id).toBeTruthy();
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.brandId, w.a.id))).length).toBe(1);
  });

  it("leaves the general plan alone while a campaign needs ideas, then fills the rest", async () => {
    const w = await world();
    const c = await campaign(w.a.id, w.user.id, { name: "Quiet", postsPerWeek: 1, startDate: day(-1), endDate: day(6) });
    await idea(w.user.id, { brandIds: [w.a.id], campaign: c.name });
    for (let i = 0; i < 12; i++) await idea(w.user.id, { brandIds: [w.a.id] });
    const [cfg] = await db.insert(brandAgents).values({ brandId: w.a.id, agentCode: "strategist", enabled: true }).returning();
    const out = await runStrategist({ brand: w.a, config: cfg, now: new Date() } as never);
    expect(out.summary).toContain("enough for");
    expect(claude.tasks.filter((t) => t.source === "workflow:plan-ideas")).toHaveLength(0);
  });
});
