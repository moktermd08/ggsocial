import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { can } from "@/lib/auth";
import { db, posts, postTargets, channels, attachments, activity, media } from "@/lib/db";
import { defaultOptions, validateTarget, type MediaItem } from "@/lib/platforms";
import { checkTargets } from "@/lib/playbook/check";
import { getBrandPlaybook } from "@/server/playbook";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Body = z.object({
  brand: z.string().min(1),
  title: z.string().max(500).default(""),
  body: z.string().min(1).max(100_000),
  /** Channel handles or ids on the brand. Leave out to use every connected channel. */
  channels: z.array(z.string().min(1)).max(30).optional(),
  /** Ids returned by POST /api/agent/media/upload, or found with GET /api/agent/media. */
  mediaIds: z.array(z.string().min(1)).max(20).default([]),
  firstComment: z.string().max(10_000).nullish(),
  /** A playbook format code (post, reel, short…). Leave out to let the platform and media decide. */
  format: z.string().nullish(),
  tags: z.array(z.string().max(60)).max(30).default([]),
  campaign: z.string().max(120).nullish(),
  /** The time the author suggests. It books nothing: a person schedules after approval. */
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  /** Default true. false leaves it as a draft. */
  submitForReview: z.boolean().default(true),
});

/**
 * Create a post and, by default, send it to the Review inbox. This is as far as
 * an agent token goes: it can never schedule, approve or publish.
 *
 *   POST /api/agent/posts
 *   { "brand": "acme", "title": "…", "body": "caption #a #b #c", "channels": ["acme-youtube"],
 *     "mediaIds": ["…"], "format": "short" }
 *
 * The same platform and playbook checks the composer runs are applied. If any
 * "error" remains the post is saved as a draft instead, `submitted` is false and
 * `issues` says what to fix; fix it and send the request again.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const d = parsed.data;

    const picked = pickBrands(brands, d.brand);
    if (picked.length !== 1) throw new AgentError("Name exactly one brand.");
    const brand = picked[0];
    if (!can.edit(brand.role)) throw new AgentError(`The token's owner is a ${brand.role} on ${brand.slug} and cannot create posts.`, 403);

    // Channels: by handle or id, on this brand only.
    const all = await db.select().from(channels).where(eq(channels.brandId, brand.id));
    const wanted = d.channels?.map((c) => c.toLowerCase());
    const chosen = wanted
      ? all.filter((c) => wanted.includes(c.id.toLowerCase()) || wanted.includes(c.handle.toLowerCase()))
      : all.filter((c) => c.status === "connected");
    if (wanted) {
      const missing = wanted.filter((w) => !chosen.some((c) => c.id.toLowerCase() === w || c.handle.toLowerCase() === w));
      if (missing.length) throw new AgentError(`Not a channel on ${brand.slug}: ${missing.join(", ")}. GET /api/agent/brands lists them.`, 404);
    }
    if (chosen.length === 0) throw new AgentError("No channel to post to. Name one in `channels`.");

    // Media must be this brand's own, or a master asset its owner can see; keep to the brand's for now.
    const files = d.mediaIds.length
      ? await db.select().from(media).where(and(inArray(media.id, d.mediaIds), eq(media.brandId, brand.id)))
      : [];
    const missingMedia = d.mediaIds.filter((id) => !files.some((f) => f.id === id));
    if (missingMedia.length) throw new AgentError(`Not in ${brand.slug}'s media library: ${missingMedia.join(", ")}.`, 404);
    const items = d.mediaIds.map((id) => files.find((f) => f.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m));

    // The checks a person would hit: each platform's own limits, then the brand's playbook.
    const rules = await getBrandPlaybook(brand.id);
    const optionsFor = (c: (typeof chosen)[number]) => ({ ...defaultOptions(c.platform), ...((c.settings ?? {}) as Record<string, unknown>) });
    const platformIssues = chosen.flatMap((c) =>
      validateTarget({ platformId: c.platform, body: d.body, media: items as MediaItem[], options: optionsFor(c) })
        .map((i) => ({ channel: c.handle, platform: c.platform, level: i.level, message: i.message })));
    const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
    const playbook = checkTargets(rules, {
      title: d.title, body: d.body, postType: d.format ?? null, timezone: brand.timezone,
      scheduledAt: scheduledAt?.toISOString() ?? null, media: items,
      targets: chosen.map((c) => ({ channelId: c.id, platform: c.platform, firstComment: d.firstComment, options: optionsFor(c) })),
    });
    const playbookIssues = playbook.flatMap((r) => {
      const c = chosen.find((x) => x.id === r.channelId);
      return r.issues.map((i) => ({ channel: c?.handle ?? r.channelId, platform: r.platform, level: i.level, message: i.message }));
    });
    const issues = [...platformIssues, ...playbookIssues];
    const blocked = issues.some((i) => i.level === "error");
    const submitted = d.submitForReview && !blocked;

    const [post] = await db.insert(posts).values({
      brandId: brand.id, title: d.title, body: d.body, status: submitted ? "in_review" : "draft",
      scheduledAt, tags: d.tags, campaign: d.campaign ?? null, postType: d.format ?? null,
      createdBy: agent.userId, agentCode: "api",
    }).returning();

    for (const c of chosen) {
      await db.insert(postTargets).values({
        postId: post.id, channelId: c.id, firstComment: d.firstComment ?? null,
        options: optionsFor(c), status: "pending", scheduledAt,
      });
    }
    for (const [i, mediaId] of d.mediaIds.entries()) {
      await db.insert(attachments).values({ postId: post.id, mediaId, position: i });
    }
    await db.insert(activity).values({
      brandId: brand.id, actorId: agent.userId, action: submitted ? "post.submitted" : "post.draft", entity: "post", entityId: post.id,
      meta: { agent: agent.name, via: "api" },
    });

    return {
      postId: post.id,
      status: post.status,
      submitted,
      url: `/posts/${post.id}`,
      issues: issues.map(({ channel, level, message }) => ({ channel, level, message })),
      next: submitted
        ? "In the Review inbox. A person approves it; nothing is scheduled or published until then."
        : blocked ? "Saved as a draft: fix every error in `issues` and create it again." : "Saved as a draft.",
    };
  });
}

export const dynamic = "force-dynamic";
