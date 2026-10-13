import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

import { db, users, brands, channels, media, attachments, posts, postTargets, postVersions } from "@/lib/db";
import { settleFormats, whyNotFit, platformLimitProblems } from "@/server/format-fit";
import { publishBody } from "@/server/versions";
import { validateTarget } from "@/lib/platforms";

let seq = 0;
const TAGS = " #ops #tips #growth";
type V = { format: string; body?: string; outline?: string[] };

async function world(opts: { agent?: boolean; platforms: string[]; versions: V[]; images?: number; videos?: number }) {
  const n = ++seq;
  await db.insert(users).values({ email: `ff${n}@t.test`, name: "U", passwordHash: "x" });
  const [brand] = await db.insert(brands).values({ name: `B${n}`, slug: `ff${n}`, timezone: "UTC" }).returning();
  const [post] = await db.insert(posts).values({
    brandId: brand.id, title: "No-show fix", body: "Base post body for everyone." + TAGS, agentCode: opts.agent === false ? null : "writer",
  }).returning();
  const chans = [] as (typeof channels.$inferSelect)[];
  const targets = [] as (typeof postTargets.$inferSelect)[];
  for (const p of opts.platforms) {
    const [c] = await db.insert(channels).values({ brandId: brand.id, platform: p, handle: `h-${p}`, mode: "live" }).returning();
    chans.push(c);
    const [t] = await db.insert(postTargets).values({ postId: post.id, channelId: c.id, bodyOverride: `tuned copy for ${p}`, status: "pending" }).returning();
    targets.push(t);
  }
  for (const v of opts.versions) {
    await db.insert(postVersions).values({
      postId: post.id, format: v.format, title: "T", body: v.body ?? `${v.format} caption${TAGS}`, outline: v.outline ?? ["one", "two", "three", "four"],
    });
  }
  let pos = 0;
  const add = async (kind: "image" | "video") => {
    const [m] = await db.insert(media).values({ brandId: brand.id, kind, url: `https://m.test/${kind}${pos}`, originalName: `${kind}${pos}`, mimeType: kind === "image" ? "image/png" : "video/mp4", size: 1, width: 1080, height: 1350, durationMs: kind === "video" ? 20_000 : null } as never).returning();
    await db.insert(attachments).values({ postId: post.id, mediaId: m.id, position: pos++ });
  };
  for (let i = 0; i < (opts.images ?? 0); i++) await add("image");
  for (let i = 0; i < (opts.videos ?? 0); i++) await add("video");
  const target = (p: string) => db.query.postTargets.findFirst({ where: eq(postTargets.channelId, chans.find((c) => c.platform === p)!.id) }).then((t) => t!);
  return { brand, post, chans, targets, target };
}
const version = async (postId: string, format: string) => (await db.select().from(postVersions).where(eq(postVersions.postId, postId))).find((v) => v.format === format)!;

describe("settleFormats", () => {
  it("sends Instagram a carousel when the slides have their images", async () => {
    const w = await world({ platforms: ["instagram"], versions: [{ format: "reel" }, { format: "carousel" }, { format: "post" }], images: 4 });
    const out = await settleFormats(w.post.id);
    expect(out[0].chose).toBe("Carousel");
    const t = await w.target("instagram");
    expect(t.useVersion).toBe(true);
    expect(t.versionId).toBe((await version(w.post.id, "carousel")).id);
    expect(publishBody(t, await version(w.post.id, "carousel"), w.post)).toContain("carousel caption");
  });

  it("sends Instagram a reel only when there is a video", async () => {
    const w = await world({ platforms: ["instagram"], versions: [{ format: "reel" }, { format: "carousel" }, { format: "post" }], videos: 1 });
    await settleFormats(w.post.id);
    const t = await w.target("instagram");
    expect(t.versionId).toBe((await version(w.post.id, "reel")).id);
    expect(t.options).toMatchObject({ format: "reel" });
  });

  it("falls back to the plain post when the richer format cannot be delivered, and says why", async () => {
    const w = await world({ platforms: ["instagram"], versions: [{ format: "reel" }, { format: "carousel" }, { format: "post" }], images: 1 });
    const out = await settleFormats(w.post.id);
    expect(out[0].chose).toBe("Text post");
    expect(out[0].note).toContain("needs a video");
    const t = await w.target("instagram");
    expect(t.useVersion).toBe(false);
    // The channel's own tuned copy still goes out.
    expect(publishBody(t, await version(w.post.id, "post"), w.post)).toBe("tuned copy for instagram");
    expect(t.options).not.toMatchObject({ format: "reel" });
  });

  it("goes back to the post when the media a format needed is taken away", async () => {
    const w = await world({ platforms: ["instagram"], versions: [{ format: "carousel" }, { format: "post" }], images: 4 });
    await settleFormats(w.post.id);
    expect((await w.target("instagram")).useVersion).toBe(true);
    await db.delete(attachments).where(eq(attachments.postId, w.post.id));
    await settleFormats(w.post.id);
    expect((await w.target("instagram")).useVersion).toBe(false);
  });

  it("sends X a thread when every part fits, and the single post when one part does not", async () => {
    const fits = await world({ platforms: ["x"], versions: [{ format: "thread", outline: ["a".repeat(200), "b".repeat(200), "c".repeat(100)] }, { format: "post" }] });
    await settleFormats(fits.post.id);
    const t = await fits.target("x");
    expect(t.useVersion).toBe(true);
    expect(t.options).toMatchObject({ thread: true });
    // Three parts of up to 200 characters is long overall, but each part is under X's 280.
    expect(publishBody(t, await version(fits.post.id, "thread"), fits.post).split("\n\n")).toHaveLength(3);

    const long = await world({ platforms: ["x"], versions: [{ format: "thread", outline: ["a".repeat(300), "short"] }, { format: "post" }] });
    const out = await settleFormats(long.post.id);
    expect(out[0].chose).toBe("Text post");
    expect((await long.target("x")).options).not.toMatchObject({ thread: true });
  });

  it("does not adopt a version that breaks the playbook's must-rules for its format", async () => {
    // The carousel rule wants exactly three hashtags.
    const w = await world({ platforms: ["instagram"], versions: [{ format: "carousel", body: "caption with no tags" }, { format: "post" }], images: 4 });
    const out = await settleFormats(w.post.id);
    expect(out[0].chose).toBe("Text post");
    expect(out[0].note).toMatch(/hashtag/i);
  });

  it("picks each channel's own format from the same post", async () => {
    const w = await world({
      platforms: ["instagram", "x", "bluesky"], images: 4,
      versions: [{ format: "carousel" }, { format: "thread", outline: ["a", "b", "c"] }, { format: "post" }],
    });
    await settleFormats(w.post.id);
    expect((await w.target("instagram")).useVersion).toBe(true);
    expect((await w.target("x")).options).toMatchObject({ thread: true });
    expect((await w.target("bluesky")).useVersion).toBe(false);
  });

  it("leaves a post a person wrote alone", async () => {
    const w = await world({ agent: false, platforms: ["instagram"], versions: [{ format: "carousel" }], images: 4 });
    expect(await settleFormats(w.post.id)).toEqual([]);
    expect((await w.target("instagram")).useVersion).toBe(false);
  });
});

describe("platformLimitProblems", () => {
  it("names the channel whose real text is over the limit", async () => {
    const w = await world({ platforms: ["x", "bluesky"], versions: [] });
    await db.update(postTargets).set({ bodyOverride: "x".repeat(400) }).where(eq(postTargets.id, w.targets[0].id));
    const problems = await platformLimitProblems(w.post.id);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^X: Part 1 is 400 characters/);
  });

  it("checks a version's text, not the override it replaced", async () => {
    const w = await world({ platforms: ["bluesky"], versions: [{ format: "article", body: "y".repeat(2000) }] });
    const art = await version(w.post.id, "article");
    await db.update(postTargets).set({ versionId: art.id, useVersion: true, bodyOverride: "fine" }).where(eq(postTargets.id, w.targets[0].id));
    expect((await platformLimitProblems(w.post.id))[0]).toMatch(/Bluesky: 2000 characters/);
  });

  it("skips channels that are waiting for their media", async () => {
    const w = await world({ platforms: ["x"], versions: [] });
    await db.update(postTargets).set({ bodyOverride: "x".repeat(400) }).where(eq(postTargets.id, w.targets[0].id));
    expect(await platformLimitProblems(w.post.id, [w.targets[0].id])).toEqual([]);
  });
});

describe("whyNotFit and validateTarget", () => {
  it("wants slides for a carousel and a video for a reel", () => {
    const img = (n: number) => Array.from({ length: n }, () => ({ kind: "image", originalName: "i" })) as never;
    expect(whyNotFit({ format: "carousel", body: "c", outline: [] }, "instagram", {}, img(1))).toMatch(/at least two images/);
    expect(whyNotFit({ format: "carousel", body: "c", outline: [] }, "instagram", {}, img(3))).toBeNull();
    expect(whyNotFit({ format: "reel", body: "c", outline: [] }, "instagram", {}, img(3))).toMatch(/needs a video/);
  });

  it("does not count a whole thread against the single-post limit", () => {
    const body = ["a".repeat(250), "b".repeat(250)].join("\n\n");
    expect(validateTarget({ platformId: "x", body, media: [], options: { thread: true } }).filter((i) => i.level === "error")).toEqual([]);
    expect(validateTarget({ platformId: "x", body, media: [], options: {} }).filter((i) => i.level === "error")).not.toEqual([]);
  });
});
