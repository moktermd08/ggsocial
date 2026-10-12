import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());
// Drafting pulls in the model client; these tests never call it.
vi.mock("@/server/drafting", () => ({
  brandBook: () => "", client: () => { throw new Error("no model in tests"); }, explain: (e: unknown) => { throw e; },
  fallbackFor: () => ({}), MODELS: { writing: "x" }, DraftingError: class extends Error {},
}));

import { db, users, brands, channels, posts, postTargets, postVersions } from "@/lib/db";
import { assignVersions } from "@/server/versions";
import { snapPostTargets } from "@/server/schedule";

let seq = 0;
async function seed(platforms: string[], times: Record<string, string> = {}) {
  const n = ++seq;
  await db.insert(users).values({ email: `v${n}@t.test`, name: "U", passwordHash: "x" });
  const [brand] = await db.insert(brands).values({ name: `B${n}`, slug: `vb${n}`, timezone: "UTC" }).returning();
  const [post] = await db.insert(posts).values({ brandId: brand.id, body: "base", title: "t" }).returning();
  const targets = [];
  for (const platform of platforms) {
    const [ch] = await db.insert(channels).values({
      brandId: brand.id, platform, handle: platform, mode: "manual",
      settings: times[platform] ? { postTimes: times[platform], postDays: "sun-sat" } : { postDays: "sun-sat" },
    }).returning();
    const [t] = await db.insert(postTargets).values({ postId: post.id, channelId: ch.id, status: "pending" }).returning();
    targets.push(t);
  }
  return { brand, post, targets };
}

describe("assignVersions", () => {
  it("points each channel at the best format that exists, and keeps a person's choice", async () => {
    const { post, targets } = await seed(["instagram", "x", "linkedin"]);
    const [reel, thread, post1] = await db.insert(postVersions).values([
      { postId: post.id, format: "reel", body: "r", outline: ["a"], script: "s" },
      { postId: post.id, format: "thread", body: "t", outline: ["1", "2"] },
      { postId: post.id, format: "post", body: "p" },
    ]).returning();

    // The person already chose the plain post for LinkedIn.
    await db.update(postTargets).set({ versionId: post1.id }).where(eq(postTargets.id, targets[2].id));

    expect(await assignVersions(post.id)).toBe(2);
    const rows = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(targets[0].id)).toMatchObject({ versionId: reel.id, options: { format: "reel" } });
    expect(by(targets[1].id)).toMatchObject({ versionId: thread.id, options: { thread: true } });
    expect(by(targets[2].id).versionId).toBe(post1.id);

    // Reset re-picks LinkedIn's best (no carousel exists, so the post stays).
    await assignVersions(post.id, { reset: true });
    expect((await db.select().from(postTargets).where(eq(postTargets.id, targets[2].id)))[0].versionId).toBe(post1.id);
  });
});

describe("snapPostTargets", () => {
  it("books each channel on its own slot and the post on the earliest", async () => {
    const { post, targets } = await seed(["linkedin", "x"], { linkedin: "09:00", x: "17:00" });
    const wanted = new Date(Date.now() + 2 * 86_400_000);
    wanted.setUTCHours(11, 30, 0, 0);
    await db.update(posts).set({ scheduledAt: wanted }).where(eq(posts.id, post.id));
    await db.update(postTargets).set({ scheduledAt: wanted, status: "scheduled" }).where(eq(postTargets.postId, post.id));

    const moved = await snapPostTargets(post.id);
    expect(moved).toHaveLength(2);
    const rows = await db.select().from(postTargets).where(eq(postTargets.postId, post.id));
    const at = (id: string) => rows.find((r) => r.id === id)!.scheduledAt!.toISOString().slice(11, 16);
    expect(at(targets[0].id)).toBe("09:00"); // next day's 09:00, since 11:30 is past it
    expect(at(targets[1].id)).toBe("17:00");
    const after = (await db.query.posts.findFirst({ where: eq(posts.id, post.id) }))!;
    expect(after.scheduledAt!.getTime()).toBe(Math.min(...rows.map((r) => r.scheduledAt!.getTime())));
  });
});
