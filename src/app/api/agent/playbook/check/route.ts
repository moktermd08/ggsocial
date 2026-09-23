import { z } from "zod";
import { db, posts, channels } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { checkTargets } from "@/lib/playbook/check";
import { checkSavedPost, getBrandPlaybook } from "@/server/playbook";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Media = z.object({
  kind: z.enum(["image", "video", "document"]),
  name: z.string().max(200).optional(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  durationSeconds: z.number().positive().nullish(),
});

const Draft = z.object({
  brand: z.string().min(1),
  /** A platform id (instagram, tiktok…) or a channel handle on the brand. */
  platform: z.string().min(1),
  /** A playbook code (post, reel…). Leave out to let the platform and media decide. */
  format: z.string().nullish(),
  title: z.string().max(500).default(""),
  body: z.string().max(100_000).default(""),
  firstComment: z.string().max(10_000).nullish(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  options: z.record(z.string(), z.unknown()).optional(),
  media: z.array(Media).max(20).default([]),
});

const Saved = z.object({ postId: z.string().min(1) });

/**
 * Check content against a brand's playbook before handing it over — the same
 * checks the composer, scheduling and approval run.
 *
 *   POST /api/agent/playbook/check
 *   { "brand": "acme", "platform": "instagram", "format": "reel", "title": "Launch day", "body": "… #a #b #c",
 *     "scheduledAt": "2026-09-24T19:30:00+06:00", "media": [{ "kind": "video", "width": 1080, "height": 1920, "durationSeconds": 42 }] }
 *
 * or `{ "postId": "…" }` to check a saved post on every channel it goes to.
 * `passed` is false while any "error" remains; "warn" issues are advice.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ brands }) => {
    const json = await req.json().catch(() => null);

    if (json && typeof json === "object" && "postId" in json) {
      const { postId } = Saved.parse(json);
      const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
      if (!post || !brands.some((b) => b.id === post.brandId)) throw new AgentError("Post not found.", 404);
      const results = await checkSavedPost(postId) ?? [];
      return {
        passed: !results.some((r) => r.issues.some((i) => i.level === "error")),
        channels: results.map((r) => ({
          platform: r.platform, handle: r.handle, rule: r.rule?.code ?? null,
          issues: r.issues.map(({ level, message }) => ({ level, message })),
          checklist: r.checklist.map((i) => i.text),
        })),
      };
    }

    const parsed = Draft.safeParse(json);
    if (!parsed.success) throw new AgentError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const d = parsed.data;
    const [brand] = pickBrands(brands, d.brand);
    if (!brand) throw new AgentError("Name one brand.");

    // A handle on the brand resolves to its platform, and brings its saved options.
    const chans = await db.select().from(channels).where(inArray(channels.brandId, [brand.id]));
    const channel = chans.find((c) => c.handle.toLowerCase() === d.platform.toLowerCase());
    const platform = channel?.platform ?? d.platform.toLowerCase();

    const [result] = checkTargets(await getBrandPlaybook(brand.id), {
      title: d.title, body: d.body, postType: d.format ?? null, timezone: brand.timezone,
      scheduledAt: d.scheduledAt ? new Date(d.scheduledAt).toISOString() : null,
      media: d.media.map((m, i) => ({
        kind: m.kind, originalName: m.name ?? `file ${i + 1}`, width: m.width, height: m.height,
        durationMs: m.durationSeconds ? Math.round(m.durationSeconds * 1000) : null,
      })),
      targets: [{ channelId: channel?.id ?? "draft", platform, firstComment: d.firstComment, options: { ...(channel?.settings ?? {}), ...(d.options ?? {}) } }],
    });
    return {
      passed: !result.issues.some((i) => i.level === "error"),
      rule: result.rule?.code ?? null,
      issues: result.issues.map(({ level, message }) => ({ level, message })),
      checklist: result.checklist.filter((i) => i.for !== "human").map((i) => i.text),
    };
  });
}

export const dynamic = "force-dynamic";
