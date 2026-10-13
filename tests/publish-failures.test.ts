import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

const platform = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@/lib/platforms", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platforms")>("@/lib/platforms");
  return { ...actual, getPlatform: () => ({ id: "fake", name: "Fake", publish: platform.publish }) };
});
vi.mock("@/server/channel-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/channel-auth")>("@/server/channel-auth");
  return { ...actual, freshCredentials: async () => ({ token: "t" }) };
});
vi.mock("@/server/media", () => ({ publicUrl: (u: string) => u }));
vi.mock("@/server/actions/engagement", () => ({ openPostEngagement: vi.fn() }));
const alerts = vi.hoisted(() => ({ sendAlert: vi.fn() }));
vi.mock("@/server/alerts", () => alerts);

import { db, users, brands, channels, posts, postTargets } from "@/lib/db";
import { PlatformError, apiFetch } from "@/lib/platforms/types";
import { classifyFailure, retryDelayMs } from "@/lib/platforms/retry";
import { publishTarget, runDuePublishes } from "@/server/publish";
import { facebook } from "@/lib/platforms/adapters/facebook";
import { x } from "@/lib/platforms/adapters/x";

let seq = 0;
async function seed(attempts = 0) {
  const n = ++seq;
  await db.insert(users).values({ email: `f${n}@t.test`, name: "U", passwordHash: "x" });
  const [brand] = await db.insert(brands).values({ name: `B${n}`, slug: `fb${n}` }).returning();
  const at = new Date(Date.now() - 60_000);
  const [channel] = await db.insert(channels).values({ brandId: brand.id, platform: "fake", handle: "h", mode: "live", settings: { postTimes: "03:07", postDays: "sun-sat" } }).returning();
  const [post] = await db.insert(posts).values({ brandId: brand.id, body: "hello" }).returning();
  const [target] = await db.insert(postTargets).values({ postId: post.id, channelId: channel.id, status: "scheduled", scheduledAt: at, attempts }).returning();
  return target;
}
const row = async (id: string) => (await db.query.postTargets.findFirst({ where: eq(postTargets.id, id) }))!;

beforeEach(() => { platform.publish.mockReset(); alerts.sendAlert.mockReset(); });

describe("classifyFailure", () => {
  it.each([
    [new PlatformError("x", 429), "retry"],
    [new PlatformError("x", 503), "retry"],
    [new PlatformError("x", 500), "ambiguous"],
    [new PlatformError("x", 502), "ambiguous"],
    [new PlatformError("x", 504), "ambiguous"],
    [new PlatformError("x", 403), "permanent"],
    [new PlatformError("x", 400), "permanent"],
    [new PlatformError("x", 404), "permanent"],
    [new Error("getaddrinfo ENOTFOUND graph.facebook.com"), "retry"],
    [new Error("The operation was aborted due to timeout"), "ambiguous"],
    [new Error("boom"), "retry"],
  ])("%s -> %s", (err, kind) => {
    expect(classifyFailure(err).kind).toBe(kind);
  });

  it("passes the platform's Retry-After along", () => {
    expect(classifyFailure(new PlatformError("x", 429, 120_000))).toEqual({ kind: "retry", retryAfterMs: 120_000 });
  });

  it("waits longer each time, and at least as long as the platform asked", () => {
    expect(retryDelayMs(1)).toBe(10 * 60_000);
    expect(retryDelayMs(2)).toBe(30 * 60_000);
    expect(retryDelayMs(1, 3_600_000)).toBe(3_600_000);
    expect(retryDelayMs(1, 99 * 3_600_000)).toBe(6 * 3_600_000);
  });
});

describe("apiFetch", () => {
  it("raises a PlatformError with the status and Retry-After", async () => {
    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429, headers: { "retry-after": "90" } }));
    const err = await apiFetch("https://x.test", { label: "X post" }).catch((e) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 90_000 });
    expect(err.message).toContain("X post failed (429)");
    vi.unstubAllGlobals();
  });
});

describe("publishTarget failures", () => {
  it("backs off a rate-limited post instead of retrying on the next tick", async () => {
    const t = await seed();
    platform.publish.mockRejectedValue(new PlatformError("rate limited", 429));
    const before = Date.now();
    expect(await publishTarget(t.id)).toMatchObject({ ok: false, willRetry: true });
    const r = await row(t.id);
    expect(r.status).toBe("scheduled");
    expect(r.scheduledAt!.getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
    // The very next tick finds nothing due.
    platform.publish.mockClear();
    expect(await runDuePublishes()).toEqual([]);
    expect(platform.publish).not.toHaveBeenCalled();
  });

  it("honours a long Retry-After", async () => {
    const t = await seed();
    platform.publish.mockRejectedValue(new PlatformError("rate limited", 429, 2 * 3_600_000));
    await publishTarget(t.id);
    expect((await row(t.id)).scheduledAt!.getTime()).toBeGreaterThanOrEqual(Date.now() + 2 * 3_600_000 - 1000);
  });

  it("sends the retry once its time comes, without waiting for the channel's slot", async () => {
    await seed(1);
    platform.publish.mockResolvedValue({ externalId: "e" });
    // Due, but the channel only posts at 03:07: a first send would be moved there. A retry is not.
    expect(await runDuePublishes()).toEqual([expect.objectContaining({ ok: true, status: "published" })]);
  });

  it("does not repost when the platform may already have it", async () => {
    const t = await seed();
    platform.publish.mockRejectedValue(new PlatformError("bad gateway", 502));
    expect(await publishTarget(t.id)).toMatchObject({ ok: false, willRetry: false });
    const r = await row(t.id);
    expect(r.status).toBe("failed");
    expect(r.lastError).toContain("may or may not have gone out");
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "post_failed" }));
    expect(alerts.sendAlert.mock.calls[0][0].lines[0]).toContain("may already be live");
  });

  it("stops at once on a refusal that trying again cannot fix", async () => {
    const t = await seed();
    platform.publish.mockRejectedValue(new PlatformError("no permission", 403));
    expect(await publishTarget(t.id)).toMatchObject({ ok: false, willRetry: false });
    expect((await row(t.id)).status).toBe("failed");
    expect(platform.publish).toHaveBeenCalledTimes(1);
  });
});

describe("a failure after the post is live", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    channel: { externalId: "page1", handle: "h" }, credentials: { accessToken: "tok" }, media: [], options: {},
    body: "hello", firstComment: "first!", publicUrl: (m: { url: string }) => m.url, ...over,
  }) as never;

  it("keeps a Facebook post that landed when its first comment fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return url.endsWith("/comments") ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ id: "page1_99" }), { status: 200 });
    });
    const res = await facebook.publish(ctx());
    expect(res.externalId).toBe("page1_99");
    expect(res.note).toContain("first comment could not be added");
    expect(calls).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("reports a thread cut halfway instead of posting it again from the top", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return n === 1 ? new Response(JSON.stringify({ data: { id: "t1" } }), { status: 200 })
        : n === 2 ? new Response(JSON.stringify({ data: { id: "t2" } }), { status: 200 })
        : new Response("down", { status: 503 });
    });
    const res = await x.publish(ctx({ options: { thread: true }, body: "one\n\ntwo\n\nthree", firstComment: null }));
    expect(res.externalId).toBe("t1");
    expect(res.note).toContain("stopped after part 2 of 3");
    vi.unstubAllGlobals();
  });

  it("still fails when the very first post of a thread fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(x.publish(ctx({ options: { thread: true }, body: "one\n\ntwo", firstComment: null }))).rejects.toBeInstanceOf(PlatformError);
    vi.unstubAllGlobals();
  });
});
