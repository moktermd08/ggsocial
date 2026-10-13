import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

const auth = vi.hoisted(() => ({ role: "editor" as string, userId: "" }));
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireUser: async () => ({ id: auth.userId }),
    requireBrandRole: async () => ({ user: { id: auth.userId }, role: auth.role }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
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

import { db, users, brands, channels, contentIdeas, memberships, posts, postTargets } from "@/lib/db";
import { contentHash, stampApproval, stampLegacyApprovals } from "@/server/approval";
import { publishTarget } from "@/server/publish";
import { publishTargetNowAction, reviewPostAction, savePostAction } from "@/server/actions/posts";
import { checkSavedPost } from "@/server/playbook";
import { cronDenied } from "@/server/cron-auth";
import { resumeStranded } from "@/server/channel-auth";
import { publishPost } from "@/server/workflows/publish-post";

let seq = 0;
async function seed(opts: { status?: "scheduled" | "in_review" | "draft"; hash?: boolean } = {}) {
  const n = ++seq;
  const [user] = await db.insert(users).values({ email: `a${n}@t.test`, name: "U", passwordHash: "x" }).returning();
  auth.userId = user.id;
  const [brand] = await db.insert(brands).values({ name: `B${n}`, slug: `ag${n}`, timezone: "UTC" }).returning();
  await db.insert(memberships).values({ userId: user.id, brandId: brand.id, role: "owner" });
  const at = new Date(Date.now() - 60_000);
  const [channel] = await db.insert(channels).values({ brandId: brand.id, platform: "bluesky", handle: "h", mode: "live", settings: { postTimes: at.toISOString().slice(11, 16), postDays: "sun-sat" } }).returning();
  const [post] = await db.insert(posts).values({ brandId: brand.id, title: "T", body: "approved words", status: opts.status ?? "scheduled", scheduledAt: at }).returning();
  const [target] = await db.insert(postTargets).values({ postId: post.id, channelId: channel.id, status: "scheduled", scheduledAt: at }).returning();
  if (opts.hash !== false) await stampApproval(post.id);
  return { user, brand, channel, post, target };
}
const postRow = async (id: string) => (await db.query.posts.findFirst({ where: eq(posts.id, id) }))!;
const targetRow = async (id: string) => (await db.query.postTargets.findFirst({ where: eq(postTargets.id, id) }))!;

beforeEach(() => { platform.publish.mockReset(); alerts.sendAlert.mockReset(); auth.role = "editor"; });

describe("approved words", () => {
  it("fingerprints the words, not the date or the files", async () => {
    const { post, target } = await seed();
    const before = await contentHash(post.id);
    await db.update(posts).set({ scheduledAt: new Date(Date.now() + 86_400_000) }).where(eq(posts.id, post.id));
    expect(await contentHash(post.id)).toBe(before);
    await db.update(postTargets).set({ bodyOverride: "different" }).where(eq(postTargets.id, target.id));
    expect(await contentHash(post.id)).not.toBe(before);
  });

  it("sends what was approved", async () => {
    const { target } = await seed();
    platform.publish.mockResolvedValue({ externalId: "e" });
    expect(await publishTarget(target.id)).toMatchObject({ ok: true, status: "published" });
  });

  it("holds back copy that changed after approval and puts the post back in review", async () => {
    const { post, target, brand } = await seed();
    await db.update(postTargets).set({ bodyOverride: "sneaky edit" }).where(eq(postTargets.id, target.id));
    const out = await publishTarget(target.id);
    expect(out).toMatchObject({ ok: false, willRetry: false });
    expect(platform.publish).not.toHaveBeenCalled();
    const p = await postRow(post.id);
    expect(p.status).toBe("in_review");
    expect(p.approvedHash).toBeNull();
    expect((await targetRow(target.id)).status).toBe("pending");
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "approval_stale", brandId: brand.id }));
  });

  it("lets an approver's forced retry through", async () => {
    const { target } = await seed();
    await db.update(postTargets).set({ bodyOverride: "edited then forced" }).where(eq(postTargets.id, target.id));
    platform.publish.mockResolvedValue({});
    expect(await publishTarget(target.id, { force: true })).toMatchObject({ ok: true });
  });

  it("treats a post approved before fingerprints existed as approved, then guards it", async () => {
    const { post, target } = await seed({ hash: false });
    platform.publish.mockResolvedValue({});
    // No fingerprint yet: sends as it always did.
    expect(await stampLegacyApprovals()).toBeGreaterThanOrEqual(1);
    expect((await postRow(post.id)).approvedHash).not.toBeNull();
    await db.update(postTargets).set({ firstComment: "added later" }).where(eq(postTargets.id, target.id));
    expect(await publishTarget(target.id)).toMatchObject({ ok: false });
  });
});

describe("who can send a post out", () => {
  const input = (brandId: string, intent: "schedule" | "publish_now" | "review", postId?: string) => ({
    brandId, postId, title: "A post", body: "Short words here.", mediaIds: [], intent,
    scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    targets: [{ channelId: "", bodyOverride: null, firstComment: null, options: {} }],
  });

  it("makes an editor's schedule a submission for review", async () => {
    const { brand, channel } = await seed({ status: "draft", hash: false });
    auth.role = "editor";
    const i = input(brand.id, "schedule");
    i.targets[0].channelId = channel.id;
    const res = await savePostAction(i);
    expect(res.ok).toBe(true);
    const saved = await postRow((res as { ok: true; postId: string }).postId);
    expect(saved.status).toBe("in_review");
    expect(saved.approvedHash).toBeNull();
  });

  it("refuses an editor's publish-now", async () => {
    const { brand, channel } = await seed({ status: "draft", hash: false });
    auth.role = "editor";
    const i = input(brand.id, "publish_now");
    i.targets[0].channelId = channel.id;
    const res = await savePostAction(i);
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/approver access/);
    expect(platform.publish).not.toHaveBeenCalled();
  });

  it("lets an admin schedule, and records what they approved", async () => {
    const { brand, channel } = await seed({ status: "draft", hash: false });
    auth.role = "admin";
    const i = input(brand.id, "schedule");
    i.targets[0].channelId = channel.id;
    const res = await savePostAction(i);
    expect(res).toMatchObject({ ok: true });
    const saved = await postRow((res as { ok: true; postId: string }).postId);
    expect(saved.status).toBe("scheduled");
    expect(saved.approvedHash).toBe(await contentHash(saved.id));
  });

  it("stops an editor publishing a target of a post nobody approved", async () => {
    const { target, post } = await seed({ status: "in_review", hash: false });
    await db.update(posts).set({ status: "in_review" }).where(eq(posts.id, post.id));
    auth.role = "editor";
    await expect(publishTargetNowAction(target.id)).rejects.toThrow(/not been approved/);
    auth.role = "approver";
    platform.publish.mockResolvedValue({});
    await expect(publishTargetNowAction(target.id)).resolves.toMatchObject({ ok: true });
  });

  it("records the approval when an approver approves on the post's page", async () => {
    const { post } = await seed({ status: "in_review", hash: false });
    auth.role = "approver";
    const ticked = ((await checkSavedPost(post.id)) ?? []).flatMap((r) => r.checklist).map((i) => i.id);
    const r2 = await reviewPostAction(post.id, "approve", "", ticked);
    expect(r2).toMatchObject({ ok: true });
    const p = await postRow(post.id);
    expect(p.approvedHash).toBe(await contentHash(post.id));
  });
});

describe("cron endpoints", () => {
  const req = (auth?: string) => new Request("https://x.test/api/cron/publish", { headers: auth ? { authorization: auth } : {} });
  it("answer to no one in production without a secret", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CRON_SECRET", "");
    expect((await cronDenied(req()))!.status).toBe(503);
    vi.unstubAllEnvs();
  });
  it("need the secret when one is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cronDenied(req()))!.status).toBe(401);
    expect((await cronDenied(req("Bearer nope")))!.status).toBe(401);
    expect(cronDenied(req("Bearer s3cret"))).toBeNull();
    vi.unstubAllEnvs();
  });
  it("stay open locally without a secret", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CRON_SECRET", "");
    expect(cronDenied(req())).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("turning a post down", () => {
  it("lets the idea go back to the plan with the reason, so it can be written again", async () => {
    const { user, brand, post } = await seed({ status: "in_review", hash: false });
    const [idea] = await db.insert(contentIdeas).values({ ownerId: user.id, sequence: 3, title: "I", problem: "p", status: "drafting" }).returning();
    await db.insert(contentIdeas).values({ ownerId: user.id, sequence: 9, title: "Later", problem: "q", status: "planned" });
    await db.update(posts).set({ ideaId: idea.id }).where(eq(posts.id, post.id));
    await publishPost.onReject!({ subjectType: "post", subjectId: post.id, brandId: brand.id } as never, user.id, "Off-strategy this week.");
    const p = await postRow(post.id);
    expect(p).toMatchObject({ status: "draft", ideaId: null });
    const back = (await db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, idea.id) }))!;
    expect(back.status).toBe("backlog");
    expect(back.sequence).toBeGreaterThan(9);
    expect(back.notes).toContain("Off-strategy this week.");
  });
});

describe("reconnecting a channel", () => {
  it("sends the approved posts that were waiting on it", async () => {
    const { target, channel, post } = await seed();
    await db.update(postTargets).set({ status: "awaiting_manual", scheduledAt: new Date(Date.now() - 3_600_000) }).where(eq(postTargets.id, target.id));
    expect(await resumeStranded(channel.id, null)).toBe(1);
    const t = await targetRow(target.id);
    expect(t.status).toBe("scheduled");
    expect(t.scheduledAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);
    expect(post.id).toBeTruthy();
  });

  it("leaves a post nobody approved alone", async () => {
    const { target, channel, post } = await seed({ status: "in_review" });
    await db.update(postTargets).set({ status: "awaiting_manual" }).where(eq(postTargets.id, target.id));
    await db.update(posts).set({ status: "in_review" }).where(eq(posts.id, post.id));
    expect(await resumeStranded(channel.id, null)).toBe(0);
  });
});
