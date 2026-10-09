import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// A real Postgres (PGlite, in memory) stands in for the app database so the
// atomic claim is tested against actual SQL, not a hand-written fake.
vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

const platform = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@/lib/platforms", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platforms/types")>("@/lib/platforms/types");
  return { NotConnectedError: actual.NotConnectedError, getPlatform: () => ({ id: "fake", name: "Fake", publish: platform.publish }) };
});
vi.mock("@/server/channel-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/channel-auth")>("@/server/channel-auth");
  return { ...actual, freshCredentials: async () => ({ token: "t" }) };
});
vi.mock("@/server/media", () => ({ publicUrl: (u: string) => u }));
const engagement = vi.hoisted(() => ({ openPostEngagement: vi.fn() }));
vi.mock("@/server/actions/engagement", () => engagement);
const alerts = vi.hoisted(() => ({ sendAlert: vi.fn() }));
vi.mock("@/server/alerts", () => alerts);

import { db, users, brands, channels, posts, postTargets, activity } from "@/lib/db";
import { NotConnectedError } from "@/lib/platforms/types";
import { failInterruptedPublishes, publishTarget, runDuePublishes } from "@/server/publish";

type Status = typeof postTargets.$inferSelect["status"];
const past = () => new Date(Date.now() - 60_000);
let seq = 0;

async function seed(opts: { status?: Status; mode?: "live" | "manual"; attempts?: number; claimedAt?: Date | null; scheduledAt?: Date } = {}) {
  const n = ++seq;
  const [user] = await db.insert(users).values({ email: `u${n}@t.test`, name: "U", passwordHash: "x" }).returning();
  const [brand] = await db.insert(brands).values({ name: `B${n}`, slug: `b${n}` }).returning();
  const [channel] = await db.insert(channels).values({ brandId: brand.id, platform: "fake", handle: "h", mode: opts.mode ?? "live" }).returning();
  const [post] = await db.insert(posts).values({ brandId: brand.id, body: "hello" }).returning();
  const [target] = await db.insert(postTargets).values({
    postId: post.id, channelId: channel.id, status: opts.status ?? "scheduled",
    scheduledAt: opts.scheduledAt ?? past(), attempts: opts.attempts ?? 0, claimedAt: opts.claimedAt ?? null,
  }).returning();
  return { user, brand, channel, post, target };
}
const row = async (id: string) => (await db.query.postTargets.findFirst({ where: eq(postTargets.id, id) }))!;
const postStatus = async (id: string) => (await db.query.posts.findFirst({ where: eq(posts.id, id) }))!.status;

beforeEach(() => {
  platform.publish.mockReset();
  engagement.openPostEngagement.mockReset();
  alerts.sendAlert.mockReset();
});

describe("publishTarget", () => {
  it("publishes a live target, stores the result and clears the claim", async () => {
    const { target, post } = await seed();
    platform.publish.mockResolvedValue({ externalId: "ext1", externalUrl: "https://x.test/1" });
    const out = await publishTarget(target.id);
    expect(out).toMatchObject({ ok: true, status: "published", url: "https://x.test/1" });
    const r = await row(target.id);
    expect(r).toMatchObject({ status: "published", externalPostId: "ext1", attempts: 1, claimedAt: null, lastError: null });
    expect(r.publishedAt).toBeInstanceOf(Date);
    expect(await postStatus(post.id)).toBe("published");
    expect(engagement.openPostEngagement).toHaveBeenCalledWith(post.id);
  });

  it("queues a manual channel for a person and never calls the platform", async () => {
    const { target } = await seed({ mode: "manual" });
    const out = await publishTarget(target.id);
    expect(out).toMatchObject({ ok: true, status: "awaiting_manual" });
    expect(platform.publish).not.toHaveBeenCalled();
    expect((await row(target.id)).status).toBe("awaiting_manual");
  });

  it("leaves a published target alone unless forced", async () => {
    const { target } = await seed({ status: "published" });
    expect(await publishTarget(target.id)).toMatchObject({ ok: true, status: "published" });
    expect(platform.publish).not.toHaveBeenCalled();
  });

  it("sends the target only once when two callers race", async () => {
    const { target } = await seed();
    platform.publish.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { externalId: "e" };
    });
    const results = await Promise.all([publishTarget(target.id), publishTarget(target.id), publishTarget(target.id)]);
    expect(platform.publish).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(2);
    expect(losers.every((r) => !r.ok && !r.willRetry)).toBe(true);
    expect((await row(target.id)).attempts).toBe(1);
  });

  it("refuses a target already being published, even when forced", async () => {
    const { target } = await seed({ status: "publishing", claimedAt: new Date() });
    const out = await publishTarget(target.id, { force: true });
    expect(out).toMatchObject({ ok: false, willRetry: false });
    expect(platform.publish).not.toHaveBeenCalled();
    expect((await row(target.id)).status).toBe("publishing");
  });

  it("lets force re-send a failed target", async () => {
    const { target } = await seed({ status: "failed", attempts: 3 });
    platform.publish.mockResolvedValue({});
    expect(await publishTarget(target.id, { force: true })).toMatchObject({ ok: true, status: "published" });
    expect((await row(target.id)).attempts).toBe(4);
  });

  it("returns a failed attempt to scheduled while attempts remain", async () => {
    const { target, post } = await seed({ attempts: 0 });
    platform.publish.mockRejectedValue(new Error("boom"));
    const out = await publishTarget(target.id);
    expect(out).toMatchObject({ ok: false, error: "boom", willRetry: true });
    expect(await row(target.id)).toMatchObject({ status: "scheduled", attempts: 1, lastError: "boom", claimedAt: null });
    expect(await postStatus(post.id)).toBe("scheduled");
  });

  it("marks the target failed on the third attempt", async () => {
    const { target, post } = await seed({ attempts: 2 });
    platform.publish.mockRejectedValue(new Error("boom"));
    expect(await publishTarget(target.id)).toMatchObject({ ok: false, willRetry: false });
    expect(await row(target.id)).toMatchObject({ status: "failed", attempts: 3 });
    expect(await postStatus(post.id)).toBe("failed");
    const log = await db.select().from(activity).where(eq(activity.entityId, target.id));
    expect(log.map((a) => a.action)).toContain("target.failed");
    expect(alerts.sendAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "post_failed", key: target.id }));
  });

  it("does not alert while retries remain, or when the channel just needs connecting", async () => {
    const retry = await seed({ attempts: 0 });
    platform.publish.mockRejectedValueOnce(new Error("boom"));
    await publishTarget(retry.target.id);
    const unconnected = await seed();
    platform.publish.mockRejectedValueOnce(new NotConnectedError("Fake", "no token"));
    await publishTarget(unconnected.target.id);
    expect(alerts.sendAlert).not.toHaveBeenCalled();
  });

  it("falls back to the manual queue, without retrying, when the channel is not connected", async () => {
    const { target } = await seed();
    platform.publish.mockRejectedValue(new NotConnectedError("Fake", "no token"));
    const out = await publishTarget(target.id);
    expect(out).toMatchObject({ ok: false, willRetry: false });
    expect((await row(target.id)).status).toBe("awaiting_manual");
  });

  it("drops a channel to manual when the platform revokes the token", async () => {
    const { target, channel } = await seed();
    platform.publish.mockRejectedValue(new Error('{"error":{"code":190,"message":"expired"}}'));
    await publishTarget(target.id);
    expect((await row(target.id)).status).toBe("awaiting_manual");
    const ch = await db.query.channels.findFirst({ where: eq(channels.id, channel.id) });
    expect(ch).toMatchObject({ mode: "manual", status: "expired" });
  });

  it("does not report a failure when opening engagement throws after a publish", async () => {
    const { target } = await seed();
    platform.publish.mockResolvedValue({});
    engagement.openPostEngagement.mockRejectedValue(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await publishTarget(target.id)).toMatchObject({ ok: true, status: "published" });
  });
});

describe("post status rollup", () => {
  it("is partially_published when one target is out and another failed", async () => {
    const a = await seed({ attempts: 2 });
    const [chan2] = await db.insert(channels).values({ brandId: a.brand.id, platform: "fake", handle: "h2", mode: "live" }).returning();
    const [t2] = await db.insert(postTargets).values({ postId: a.post.id, channelId: chan2.id, status: "scheduled", scheduledAt: past() }).returning();
    platform.publish.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({});
    await publishTarget(a.target.id);
    await publishTarget(t2.id);
    expect(await postStatus(a.post.id)).toBe("partially_published");
  });
});

describe("runDuePublishes", () => {
  it("publishes due targets and skips future ones", async () => {
    const due = await seed();
    const later = await seed({ scheduledAt: new Date(Date.now() + 3_600_000) });
    platform.publish.mockResolvedValue({});
    const results = await runDuePublishes();
    const ids = results.map((r) => r.targetId);
    expect(ids).toContain(due.target.id);
    expect(ids).not.toContain(later.target.id);
    expect((await row(later.target.id)).status).toBe("scheduled");
  });

  it("does not double-send when two ticks overlap", async () => {
    const { target } = await seed();
    platform.publish.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {};
    });
    await Promise.all([runDuePublishes(), runDuePublishes()]);
    const sends = platform.publish.mock.calls.length;
    // Other tests' due rows may also be sent; this target must have gone once.
    expect((await row(target.id)).attempts).toBe(1);
    expect(sends).toBeGreaterThanOrEqual(1);
  });

  it("keeps going when an earlier target fails", async () => {
    const bad = await seed({ scheduledAt: new Date(Date.now() - 120_000) });
    const good = await seed();
    platform.publish.mockImplementation(async (ctx: { target: { id: string } }) => {
      if (ctx.target.id === bad.target.id) throw new Error("boom");
      return {};
    });
    await runDuePublishes();
    expect((await row(bad.target.id)).status).toBe("scheduled");
    expect((await row(good.target.id)).status).toBe("published");
  });
});

describe("failInterruptedPublishes", () => {
  it("fails a target stuck in publishing past the stale window and rolls up the post", async () => {
    const { target, post } = await seed({ status: "publishing", claimedAt: new Date(Date.now() - 20 * 60_000) });
    expect(await failInterruptedPublishes()).toBeGreaterThanOrEqual(1);
    const r = await row(target.id);
    expect(r.status).toBe("failed");
    expect(r.lastError).toMatch(/Interrupted/);
    expect(r.claimedAt).toBeNull();
    expect(await postStatus(post.id)).toBe("failed");
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "post_interrupted", key: target.id }));
  });

  it("leaves a recent claim alone", async () => {
    const { target } = await seed({ status: "publishing", claimedAt: new Date(Date.now() - 60_000) });
    await failInterruptedPublishes();
    expect((await row(target.id)).status).toBe("publishing");
  });

  it("does not auto-retry what it fails", async () => {
    const { target } = await seed({ status: "publishing", claimedAt: new Date(Date.now() - 20 * 60_000) });
    platform.publish.mockResolvedValue({});
    await runDuePublishes();
    expect(platform.publish).not.toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ id: target.id }) }));
    expect((await row(target.id)).status).toBe("failed");
  });
});
