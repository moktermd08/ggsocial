import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

const plat = vi.hoisted(() => ({ fetchMetrics: vi.fn() }));
vi.mock("@/lib/platforms", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platforms")>("@/lib/platforms");
  return { ...actual, getPlatform: (id: string) => ({ ...actual.getPlatform(id), fetchMetrics: plat.fetchMetrics }) };
});
vi.mock("@/server/channel-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/channel-auth")>("@/server/channel-auth");
  return { ...actual, freshCredentials: async () => ({ token: "t" }) };
});
const alerts = vi.hoisted(() => ({ sendAlert: vi.fn(async () => "sent") }));
vi.mock("@/server/alerts", () => alerts);
vi.mock("@/server/actions/engagement", () => ({ openPostEngagement: vi.fn() }));
const claude = vi.hoisted(() => ({ tasks: [] as string[] }));
vi.mock("@/server/agents/claude", () => ({
  askClaude: async (o: { task: string }) => {
    claude.tasks.push(o.task);
    return {
      output: { ideas: [{ title: "Fresh one", pillar: "Ops", problem: "p", action: "a", outcome: "o", postType: "Hook", tone: "plain", needsMedia: false, hashtags: [], why: "w" }] },
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, model: "m" },
    };
  },
  addUsage: (a: unknown) => a,
}));
vi.mock("@/server/research", () => ({ fetchSignals: async () => [], researchQueries: () => [], signalsBlock: () => "" }));

import { db, users, brands, channels, memberships, metrics, posts, postTargets, postVersions, brandLearnings, contentIdeas } from "@/lib/db";
import { MATURE_HOURS, deriveLearnings, engagementRate, formatOf, matureReading, median, type Observation } from "@/lib/performance";
import { METRIC_CHECKPOINTS_H, metricsDue, refreshDueMetrics } from "@/server/publish";
import { formatLifts, learningLines, observations, pillarLifts, recentOpenings, refreshLearnings } from "@/server/performance";
import { draftRequestText } from "@/server/drafting";
import { orderLadder } from "@/server/format-fit";
import { planIdeas } from "@/server/workflows/plan-ideas";

const H = 3_600_000;
const reading = (over: { fetchedAt: Date } & Partial<Record<string, number | Date>>) => ({ impressions: 1000, reach: 1000, likes: 0, commentCount: 0, shares: 0, saves: 0, clicks: 0, ...over });
const ob = (over: Partial<Observation>): Observation => ({ platform: "instagram", format: "post", pillar: "Ops", weekday: 2, hour: 9, rate: 0.04, ...over });
const many = (n: number, over: Partial<Observation>) => Array.from({ length: n }, () => ob(over));

describe("fair readings", () => {
  const pub = new Date("2026-10-01T09:00:00Z");
  const at = (hours: number, likes: number) => reading({ fetchedAt: new Date(pub.getTime() + hours * H), likes });

  it("judges a post on a reading from after its first two days", () => {
    const now = new Date(pub.getTime() + 100 * H);
    expect(matureReading([at(1, 5), at(24, 20), at(MATURE_HOURS + 1, 40), at(72, 55)], pub, now)?.likes).toBe(55);
    expect(matureReading([at(1, 5), at(24, 20)], pub, now)).toBeNull();
  });
  it("does not judge a post that is still young", () => {
    expect(matureReading([at(1, 5), at(20, 9)], pub, new Date(pub.getTime() + 22 * H))).toBeNull();
  });
  it("falls back on the latest reading once a post is a week old and was never read late", () => {
    expect(matureReading([at(1, 5), at(24, 20)], pub, new Date(pub.getTime() + 8 * 24 * H))?.likes).toBe(20);
  });
  it("ignores engagement it cannot trust", () => {
    expect(engagementRate(reading({ fetchedAt: pub, reach: 5, impressions: 5, likes: 4 }))).toBeNull();
    expect(engagementRate(reading({ fetchedAt: pub, reach: 1000, likes: 30, saves: 10 }))).toBeCloseTo(0.04);
  });
  it("names the format a channel went out as", () => {
    expect(formatOf({ useVersion: true, versionFormat: "carousel" })).toBe("carousel");
    expect(formatOf({ useVersion: false, versionFormat: "carousel", options: { thread: true } })).toBe("thread");
    expect(formatOf({ useVersion: false, options: { format: "reel" } })).toBe("reel");
    expect(formatOf({ useVersion: false })).toBe("post");
  });
});

describe("deriveLearnings", () => {
  it("says nothing until there are enough posts", () => {
    expect(deriveLearnings([...many(3, { format: "carousel", rate: 0.1 }), ...many(3, { rate: 0.02 })])).toEqual([]);
  });

  it("finds the format that earns more, and the one that earns less", () => {
    const l = deriveLearnings([
      ...many(5, { format: "carousel", rate: 0.08 }), ...many(5, { format: "post", rate: 0.04 }), ...many(5, { format: "thread", rate: 0.015 }),
    ]);
    const more = l.find((x) => x.dimension === "format" && x.key === "carousel")!;
    const less = l.find((x) => x.dimension === "format" && x.key === "thread")!;
    expect(more).toMatchObject({ direction: "more", n: 5 });
    expect(more.lift).toBeGreaterThan(1.5);
    expect(more.statement).toContain("carousel");
    expect(less.direction).toBe("less");
  });

  it("does not mistake a strong platform for a strong format", () => {
    // LinkedIn engages ten times as much as Instagram, but carousels are no better than posts on either.
    const l = deriveLearnings([
      ...many(4, { platform: "linkedin", format: "carousel", rate: 0.2 }), ...many(4, { platform: "linkedin", format: "post", rate: 0.2 }),
      ...many(4, { platform: "instagram", format: "carousel", rate: 0.02 }), ...many(4, { platform: "instagram", format: "post", rate: 0.02 }),
    ]);
    expect(l.filter((x) => x.dimension === "format")).toEqual([]);
  });

  it("keeps a lesson to the platform it was learned on", () => {
    const l = deriveLearnings([
      ...many(5, { platform: "instagram", format: "carousel", rate: 0.09 }), ...many(5, { platform: "instagram", format: "post", rate: 0.03 }),
      ...many(5, { platform: "x", format: "post", rate: 0.01 }), ...many(5, { platform: "x", format: "thread", rate: 0.01 }),
    ]);
    expect(l.find((x) => x.dimension === "platform_format" && x.key === "instagram:carousel")?.statement).toContain("On Instagram");
    expect(l.find((x) => x.dimension === "platform_format" && x.key.startsWith("x:"))).toBeUndefined();
  });

  it("leaves a small difference alone", () => {
    expect(deriveLearnings([...many(6, { format: "carousel", rate: 0.042 }), ...many(6, { format: "post", rate: 0.04 })])).toEqual([]);
  });

  it("learns days, dayparts and topics too", () => {
    const l = deriveLearnings([
      ...many(4, { weekday: 2, hour: 8, pillar: "Trust", rate: 0.09 }), ...many(4, { weekday: 5, hour: 20, pillar: "Offers", rate: 0.03 }),
      ...many(4, { weekday: 3, hour: 13, pillar: "Trust", rate: 0.05 }),
    ]);
    expect(l.some((x) => x.dimension === "pillar" && x.key === "Trust" && x.direction === "more")).toBe(true);
    expect(l.some((x) => x.dimension === "weekday")).toBe(true);
    expect(l.some((x) => x.dimension === "daypart")).toBe(true);
  });
  it("median", () => { expect(median([1, 9, 3])).toBe(3); expect(median([1, 3])).toBe(2); expect(median([])).toBe(0); });
});

describe("when numbers are read", () => {
  const pub = new Date("2026-10-01T00:00:00Z");
  it("is due once per checkpoint passed", () => {
    expect(metricsDue(pub, null, new Date(pub.getTime() + 30 * 60_000))).toBe(false);
    expect(metricsDue(pub, null, new Date(pub.getTime() + 2 * H))).toBe(true);
    expect(metricsDue(pub, new Date(pub.getTime() + 2 * H), new Date(pub.getTime() + 5 * H))).toBe(false);
    expect(metricsDue(pub, new Date(pub.getTime() + 2 * H), new Date(pub.getTime() + 7 * H))).toBe(true);
    expect(METRIC_CHECKPOINTS_H).toContain(48);
  });
  it("stops after the last checkpoint", () => {
    expect(metricsDue(pub, new Date(pub.getTime() + 31 * 24 * H), new Date(pub.getTime() + 60 * 24 * H))).toBe(false);
  });
});

let seq = 0;
async function brand(platforms: string[] = ["instagram"]) {
  const n = ++seq;
  const [user] = await db.insert(users).values({ email: `l${n}@t.test`, name: "U", passwordHash: "x" }).returning();
  const [b] = await db.insert(brands).values({ name: `B${n}`, slug: `lr${n}`, timezone: "UTC" }).returning();
  await db.insert(memberships).values({ userId: user.id, brandId: b.id, role: "owner" });
  const chans = [] as (typeof channels.$inferSelect)[];
  for (const p of platforms) chans.push((await db.insert(channels).values({ brandId: b.id, platform: p, handle: `h-${p}`, mode: "live" }).returning())[0]);
  return { user, brand: b, chans };
}
async function published(b: Awaited<ReturnType<typeof brand>>, opts: { ageH: number; likes: number; reads?: number[]; checked?: boolean; format?: string; pillar?: string; platform?: string; title?: string }) {
  const chan = b.chans.find((c) => c.platform === (opts.platform ?? "instagram")) ?? b.chans[0];
  const at = new Date(Date.now() - opts.ageH * H);
  let ideaId: string | null = null;
  if (opts.pillar) ideaId = (await db.insert(contentIdeas).values({ ownerId: b.user.id, sequence: ++seq, problem: "p", title: `idea ${seq}`, pillar: opts.pillar }).returning())[0].id;
  const [post] = await db.insert(posts).values({ brandId: b.brand.id, title: opts.title ?? `Post ${seq}`, body: `Body number ${seq}. More words.`, status: "published", ideaId }).returning();
  let versionId: string | null = null;
  if (opts.format && opts.format !== "post") versionId = (await db.insert(postVersions).values({ postId: post.id, format: opts.format, body: "x", outline: [] }).returning())[0].id;
  const [t] = await db.insert(postTargets).values({
    postId: post.id, channelId: chan.id, status: "published", publishedAt: at, externalPostId: `ext${seq}`, versionId, useVersion: Boolean(versionId),
    metricsCheckedAt: opts.checked === false ? null : new Date(),
  }).returning();
  for (const h of opts.reads ?? [50]) {
    await db.insert(metrics).values({ targetId: t.id, fetchedAt: new Date(at.getTime() + h * H), impressions: 1000, reach: 1000, likes: opts.likes });
  }
  return { post, target: t };
}

describe("learning from a brand's published posts", () => {
  it("stores what works, from settled readings only", async () => {
    const b = await brand();
    for (let i = 0; i < 5; i++) await published(b, { ageH: 100, likes: 90, format: "carousel", pillar: "Trust" });
    for (let i = 0; i < 5; i++) await published(b, { ageH: 100, likes: 30, pillar: "Offers" });
    await published(b, { ageH: 5, likes: 400, format: "thread", reads: [3] }); // young and noisy: not counted
    const lessons = await refreshLearnings(b.brand);
    expect(lessons.find((l) => l.dimension === "format" && l.key === "carousel")?.direction).toBe("more");
    expect(lessons.find((l) => l.dimension === "pillar" && l.key === "Trust")?.direction).toBe("more");
    expect(lessons.some((l) => l.key === "thread")).toBe(false);
    expect((await db.select().from(brandLearnings).where(eq(brandLearnings.brandId, b.brand.id))).length).toBe(lessons.length);
    // Recomputing replaces, it does not pile up.
    await refreshLearnings(b.brand);
    expect((await db.select().from(brandLearnings).where(eq(brandLearnings.brandId, b.brand.id))).length).toBe(lessons.length);
    expect((await pillarLifts(b.brand.id)).get("Trust")).toBeGreaterThan(1);
    const lines = await learningLines(b.brand.id);
    expect(lines.more.join(" ")).toMatch(/carousel/i);
    expect(lines.less.length).toBeGreaterThanOrEqual(0);
  });

  it("does not count a post the platform has deleted", async () => {
    const b = await brand();
    for (let i = 0; i < 9; i++) await published(b, { ageH: 100, likes: 40 });
    const gone = await published(b, { ageH: 100, likes: 40 });
    await db.update(postTargets).set({ removedAt: new Date() }).where(eq(postTargets.id, gone.target.id));
    expect((await observations(b.brand.id, 30, new Date(), "UTC")).length).toBe(9);
  });

  it("reminds the writer how recent posts opened", async () => {
    const b = await brand();
    await published(b, { ageH: 100, likes: 1 });
    const lines = await recentOpenings(b.brand.id);
    expect(lines[0]).toContain("Body number");
  });
});

describe("what the writer and planner are told", () => {
  it("puts the brand's numbers and recent openings in a draft request", () => {
    const text = draftRequestText({
      brand: { name: "Acme" } as never, channels: [],
      learnings: { more: ["Posts under \"Trust\" earn 1.8× the usual engagement (6 posts)."], less: ["Posts on Fridays earn 0.6× the usual engagement (5 posts)."] },
      recentOpenings: ["Most clinics lose a day a week."],
    });
    expect(text).toContain("works: Posts under \"Trust\"");
    expect(text).toContain("weaker: Posts on Fridays");
    expect(text).toContain("Most clinics lose a day a week.");
  });

  it("puts them in the strategist's briefing", async () => {
    const b = await brand();
    for (let i = 0; i < 5; i++) await published(b, { ageH: 100, likes: 90, format: "carousel", pillar: "Trust" });
    for (let i = 0; i < 5; i++) await published(b, { ageH: 100, likes: 30, pillar: "Offers" });
    await refreshLearnings(b.brand);
    claude.tasks.length = 0;
    await planIdeas.handlers.propose({ run: { context: { count: 1 } }, brand: b.brand, feedback: null, retry: false, now: new Date(), step: {} } as never);
    expect(claude.tasks[0]).toContain("Do more of:");
    expect(claude.tasks[0]).toMatch(/carousel/i);
  });
});

describe("a format that has done well here goes first", () => {
  const v = (...fs: string[]) => fs.map((format) => ({ format }));
  const fb = (m: Record<string, number>) => new Map(Object.entries(m));

  it("keeps the platform's order when there is nothing to go on", () => {
    expect(orderLadder(v("reel", "post", "video"), "facebook", fb({})).map((x) => x.format)).toEqual(["reel", "post"]);
  });
  it("puts a format the numbers favour first, even one the platform ranks below the post", () => {
    const l = orderLadder(v("reel", "post", "video"), "facebook", fb({ "facebook:video": 1.9, "facebook:reel": 0.5 }));
    expect(l.map((x) => x.format)).toEqual(["video", "reel", "post"]);
  });
  it("does not promote a format on a small edge, and always ends on the plain post", () => {
    expect(orderLadder(v("reel", "post", "video"), "facebook", fb({ "facebook:video": 1.1 })).map((x) => x.format)).toEqual(["reel", "post"]);
    expect(orderLadder(v("carousel", "post"), "linkedin", fb({ "linkedin:carousel": 0.4 })).at(-1)!.format).toBe("post");
  });
  it("only reads lifts that have enough posts behind them", async () => {
    const b = await brand(["facebook"]);
    await db.insert(brandLearnings).values([
      { brandId: b.brand.id, dimension: "platform_format", key: "facebook:video", n: 6, lift: 1.9, direction: "more", statement: "s" },
      { brandId: b.brand.id, dimension: "platform_format", key: "facebook:reel", n: 2, lift: 0.5, direction: "less", statement: "s" },
    ]);
    const lifts = await formatLifts(b.brand.id);
    expect(lifts.get("facebook:video")).toBe(1.9);
    expect(lifts.has("facebook:reel")).toBe(false);
  });
});

describe("reading the numbers", () => {
  beforeEach(() => { plat.fetchMetrics.mockReset(); alerts.sendAlert.mockClear(); });
  const ok = (likes = 10) => ({ impressions: 1000, reach: 1000, likes });

  it("reads a post as each checkpoint passes, not every time it is asked", async () => {
    const b = await brand();
    const p = await published(b, { ageH: 2, likes: 0, reads: [], checked: false });
    plat.fetchMetrics.mockResolvedValue(ok());
    expect((await refreshDueMetrics(new Date(), { brandId: b.brand.id })).read).toBe(1);
    expect((await refreshDueMetrics(new Date(), { brandId: b.brand.id })).read).toBe(0);
    expect((await refreshDueMetrics(new Date(Date.now() + 5 * H), { brandId: b.brand.id })).read).toBe(1);
    expect((await db.select().from(metrics).where(eq(metrics.targetId, p.target.id))).length).toBe(2);
  });

  it("stops counting a post the platform says is gone", async () => {
    const b = await brand();
    const p = await published(b, { ageH: 30, likes: 0, reads: [], checked: false });
    const { PlatformError } = await import("@/lib/platforms/types");
    plat.fetchMetrics.mockRejectedValue(new PlatformError("not found", 404));
    const r = await refreshDueMetrics(new Date(), { brandId: b.brand.id });
    expect(r.removed).toBe(1);
    expect((await db.query.postTargets.findFirst({ where: eq(postTargets.id, p.target.id) }))!.removedAt).not.toBeNull();
  });

  it("reports a channel it cannot read instead of hiding it", async () => {
    const b = await brand();
    await published(b, { ageH: 30, likes: 0, reads: [], checked: false });
    plat.fetchMetrics.mockRejectedValue(new Error("Instagram insights failed (500): boom"));
    const r = await refreshDueMetrics(new Date(), { brandId: b.brand.id });
    expect(r.read).toBe(0);
    expect(r.failed).toEqual([expect.objectContaining({ platform: "instagram", error: expect.stringContaining("boom") })]);
  });

  it("tells the owners when a post is far ahead of its usual after a day", async () => {
    const b = await brand();
    for (let i = 0; i < 9; i++) await published(b, { ageH: 200, likes: 40 }); // usual: 4%
    await published(b, { ageH: 26, likes: 0, reads: [], checked: false });
    plat.fetchMetrics.mockResolvedValue(ok(300)); // 30% a day in
    const r = await refreshDueMetrics(new Date(), { brandId: b.brand.id });
    expect(r.anomalies).toBe(1);
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "post_anomaly", subject: expect.stringContaining("taking off") }));
  });

  it("does not raise alarms while catching up on old posts", async () => {
    const b = await brand();
    for (let i = 0; i < 10; i++) await published(b, { ageH: 100, likes: 40, reads: [50], checked: false });
    plat.fetchMetrics.mockResolvedValue(ok(400));
    expect((await refreshDueMetrics(new Date(), { brandId: b.brand.id })).anomalies).toBe(0);
  });

  it("stays quiet about an ordinary post", async () => {
    const b = await brand();
    for (let i = 0; i < 9; i++) await published(b, { ageH: 200, likes: 40 });
    await published(b, { ageH: 26, likes: 0, reads: [], checked: false });
    plat.fetchMetrics.mockResolvedValue(ok(45));
    expect((await refreshDueMetrics(new Date(), { brandId: b.brand.id })).anomalies).toBe(0);
    expect(alerts.sendAlert).not.toHaveBeenCalled();
  });
});
