import "server-only";
import { and, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { db, brandLearnings, channels, contentIdeas, metrics, posts, postTargets, postVersions } from "@/lib/db";
import { toLocalInput } from "@/lib/format";
import { deriveLearnings, engagementRate, formatOf, matureReading, type Learning, type Observation } from "@/lib/performance";

/**
 * The brand's own numbers, read fairly and turned into lessons the agents use:
 * the strategist plans from them, the writer drafts with them in mind, and the
 * format a channel goes out as leans towards what has worked there. Nothing
 * here calls a model; it is arithmetic over published posts.
 */

const DAY = 86_400_000;

export type Observed = Observation & { targetId: string; postId: string; title: string; publishedAt: Date };

/** One observation per published channel copy that has a mature reading and enough reach to count. */
export async function observations(brandId: string, sinceDays: number, now: Date, timezone: string): Promise<Observed[]> {
  const rows = await db.select({ target: postTargets, post: posts, platform: channels.platform }).from(postTargets)
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .where(and(
      eq(posts.brandId, brandId), eq(postTargets.status, "published"), isNull(postTargets.removedAt),
      gte(postTargets.publishedAt, new Date(now.getTime() - sinceDays * DAY)),
    ));
  if (rows.length === 0) return [];

  const [readings, versions, ideas] = await Promise.all([
    db.select().from(metrics).where(inArray(metrics.targetId, rows.map((r) => r.target.id))),
    db.select({ id: postVersions.id, format: postVersions.format }).from(postVersions)
      .where(inArray(postVersions.postId, [...new Set(rows.map((r) => r.post.id))])),
    db.select({ id: contentIdeas.id, pillar: contentIdeas.pillar }).from(contentIdeas)
      .where(inArray(contentIdeas.id, [...new Set(rows.flatMap((r) => (r.post.ideaId ? [r.post.ideaId] : [])))].concat(["-"]))),
  ]);

  const out: Observed[] = [];
  for (const r of rows) {
    if (!r.target.publishedAt) continue;
    const reading = matureReading(readings.filter((m) => m.targetId === r.target.id), r.target.publishedAt, now);
    const rate = reading ? engagementRate(reading) : null;
    if (rate === null) continue;
    const local = toLocalInput(r.target.publishedAt, timezone);
    out.push({
      targetId: r.target.id, postId: r.post.id, title: r.post.title, publishedAt: r.target.publishedAt,
      platform: r.platform,
      format: formatOf({
        useVersion: r.target.useVersion, options: r.target.options,
        versionFormat: versions.find((v) => v.id === r.target.versionId)?.format ?? null,
      }),
      pillar: ideas.find((i) => i.id === r.post.ideaId)?.pillar ?? null,
      weekday: new Date(`${local.slice(0, 10)}T00:00:00Z`).getUTCDay(),
      hour: Number(local.slice(11, 13)),
      rate,
    });
  }
  return out;
}

/** Recomputes a brand's lessons from its mature numbers and stores them, replacing the last set. */
export async function refreshLearnings(brand: { id: string; timezone: string }, now = new Date()): Promise<Learning[]> {
  const learnings = deriveLearnings(await observations(brand.id, 120, now, brand.timezone));
  await db.transaction(async (tx) => {
    await tx.delete(brandLearnings).where(eq(brandLearnings.brandId, brand.id));
    if (learnings.length) {
      await tx.insert(brandLearnings).values(learnings.map((l) => ({ ...l, brandId: brand.id, computedAt: now })));
    }
  });
  return learnings;
}

export async function learningsFor(brandId: string) {
  return db.select().from(brandLearnings).where(eq(brandLearnings.brandId, brandId)).orderBy(desc(brandLearnings.n));
}

/** The lessons as lines for a prompt: what to do more of, what to do less of. */
export async function learningLines(brandId: string, opts: { platforms?: string[]; max?: number } = {}) {
  const rows = await learningsFor(brandId);
  const relevant = rows.filter((l) => {
    if (l.dimension !== "platform_format" || !opts.platforms?.length) return true;
    return opts.platforms.includes(l.key.split(":")[0]);
  });
  const pick = (dir: "more" | "less") => relevant.filter((l) => l.direction === dir).sort((a, b) => Math.abs(Math.log(b.lift)) - Math.abs(Math.log(a.lift))).slice(0, opts.max ?? 4).map((l) => l.statement);
  return { more: pick("more"), less: pick("less") };
}

/** How much better or worse than usual a format has done on a platform, once there are enough posts to say. */
export async function formatLifts(brandId: string, minPosts = 4) {
  const rows = await db.select().from(brandLearnings)
    .where(and(eq(brandLearnings.brandId, brandId), eq(brandLearnings.dimension, "platform_format")));
  return new Map(rows.filter((r) => r.n >= minPosts).map((r) => [r.key, r.lift]));
}

/** How much better or worse than usual each content pillar has done. */
export async function pillarLifts(brandId: string, minPosts = 3) {
  const rows = await db.select().from(brandLearnings)
    .where(and(eq(brandLearnings.brandId, brandId), eq(brandLearnings.dimension, "pillar")));
  return new Map(rows.filter((r) => r.n >= minPosts).map((r) => [r.key, r.lift]));
}

/** The first lines of the brand's latest posts, so a new one does not open the same way. */
export async function recentOpenings(brandId: string, limit = 12) {
  const rows = await db.select({ title: posts.title, body: posts.body }).from(posts)
    .where(and(eq(posts.brandId, brandId), notInArray(posts.status, ["failed", "draft"])))
    .orderBy(desc(posts.createdAt)).limit(limit);
  return rows.map((r) => (r.body.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 120)).filter(Boolean);
}
