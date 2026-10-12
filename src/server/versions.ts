import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { db, brands, channels, media, postTargets, postVersions, posts } from "@/lib/db";
import { platformOrNull } from "@/lib/platforms";
import {
  CONTENT_FORMATS, FORMAT_META, formatsNeeded, pickFormat, versionOptions, versionPublishText,
  type ContentFormat,
} from "@/lib/formats";
import { brandBook, client, explain, fallbackFor, MODELS, DraftingError } from "@/server/drafting";
import { getBrandPlaybook } from "@/server/playbook";
import { ideaForBrand } from "@/server/ideas";
import { recordUsage } from "@/server/ai-usage";
import { describeRule } from "@/lib/playbook/check";
import { HOOK_CRAFT, PLAIN_WRITING, PLATFORM_CRAFT } from "@/server/agents/craft";

/**
 * Format versions: one post, made ready in every format its channels can
 * carry, then pointed at the channels each suits best. Nothing here publishes.
 */

/* ----------------------------------------------------------------- reading */

export async function versionsForPost(postId: string) {
  return db.select().from(postVersions).where(eq(postVersions.postId, postId))
    .orderBy(asc(postVersions.createdAt));
}

/** The brand's live channels, which decide the formats worth making. */
async function postChannels(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) throw new Error("Post not found");
  const targets = await db.select().from(postTargets).where(eq(postTargets.postId, postId));
  const chans = targets.length
    ? await db.select().from(channels).where(inArray(channels.id, targets.map((t) => t.channelId)))
    : await db.select().from(channels).where(and(eq(channels.brandId, post.brandId), isNull(channels.archivedAt)));
  return { post, targets, chans };
}

/** The formats this post should have versions of, from its channels (or the brand's, before it has any). */
export async function formatsForPost(postId: string) {
  const { chans } = await postChannels(postId);
  return formatsNeeded(chans.map((c) => ({ platform: c.platform, category: platformOrNull(c.platform)?.category ?? null })));
}

/* -------------------------------------------------------------- generation */

const FormatEnum = z.enum(CONTENT_FORMATS);
const VersionsSchema = z.object({
  versions: z.array(z.object({
    format: FormatEnum,
    title: z.string().describe("The public title where the format has one (video, article, newsletter subject); otherwise a short internal title."),
    body: z.string().describe("The caption, or for article and newsletter the full body. For a thread, a one-line lead-in."),
    outline: z.array(z.string()).describe("Carousel and story: one entry per slide or frame, the on-screen text. Thread: one entry per post, each standing alone. Reel, short, video: the shot list, one entry per shot with what is on screen. Article and newsletter: section headings with a line each. Text post: empty."),
    script: z.string().describe("Video formats only: the words spoken, with the hook first. Empty otherwise."),
  })),
  note: z.string().describe("One line for the reviewer: the angle taken and anything to check."),
});
export type GeneratedVersions = z.infer<typeof VersionsSchema>;

const SYSTEM = `You turn one social post into every format it can go out in, for one brand. The post already says what it means to say; your job is to make each format as a person who makes that format would, not to paste the same text into different boxes.

For each format asked for:
- Keep the same idea, facts and call to action as the post. Never add a claim the brand book does not support.
- Write for the format's shape: a carousel is one point per slide with the payoff last; a thread is posts that each stand alone; a reel or short is a shot list plus the words spoken, with the hook in the first three seconds on screen and in words; a long video has chapters; an article has a headline and sections; a newsletter has a subject line and a preview before the body.
- The first line of every format is its hook, and it must work for that format's reader.
- Follow the brand book's voice, banned words and emoji policy exactly. Follow the playbook limits given for each format.

${HOOK_CRAFT}

${PLATFORM_CRAFT}

${PLAIN_WRITING}`;

const EMOJI = /\p{Extended_Pictographic}/u;

/** Problems a person should hear about, found in code rather than trusted to the model. */
export function checkVersions(out: GeneratedVersions, brand: Pick<typeof brands.$inferSelect, "bannedWords" | "emojiPolicy">) {
  const issues: string[] = [];
  const banned = brand.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  for (const v of out.versions) {
    const label = FORMAT_META[v.format].label;
    const text = [v.title, v.body, v.script, ...v.outline].join("\n");
    for (const word of banned) {
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) issues.push(`${label}: uses the banned word "${word}".`);
    }
    if (brand.emojiPolicy === "none" && EMOJI.test(text)) issues.push(`${label}: uses emoji, and this brand never does.`);
    const shape = FORMAT_META[v.format].shape;
    if ((shape === "slides" || shape === "posts" || shape === "video") && v.outline.length === 0) issues.push(`${label}: came back without its ${FORMAT_META[v.format].outlineLabel?.toLowerCase()}.`);
    if (shape === "video" && !v.script.trim()) issues.push(`${label}: came back without a script.`);
  }
  return issues;
}

export type GenerateResult = { made: ContentFormat[]; issues: string[]; note: string };

/**
 * Writes the versions of a post in the formats asked for (default: what its
 * channels need), keeping any a person has already marked ready.
 */
export async function generateVersions(
  postId: string, opts: { formats?: ContentFormat[]; source?: string; agentCode?: string | null } = {},
): Promise<GenerateResult> {
  const { post, chans } = await postChannels(postId);
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  if (!brand) throw new Error("Brand not found");

  const existing = await versionsForPost(postId);
  // Never write over what a person has signed off or has edited since an agent wrote it.
  const keep = new Set(existing.filter((v) => v.status === "ready" || (v.status === "drafted" && !v.agentCode)).map((v) => v.format));
  const wanted = (opts.formats?.length ? opts.formats : await formatsForPost(postId)).filter((f) => !keep.has(f));
  if (wanted.length === 0) return { made: [], issues: [], note: "Every format is already ready or has been edited by a person." };

  const [playbook, mine] = await Promise.all([
    getBrandPlaybook(brand.id),
    post.ideaId ? ideaForBrand(post.ideaId, brand.id) : null,
  ]);
  const rules = wanted.map((f) => playbook.find((r) => r.code === f && r.enabled)).filter((r): r is NonNullable<typeof r> => Boolean(r));

  const lines = [
    `Brand: ${brand.name}`,
    mine?.idea ? `Idea: ${mine.idea.problem}${mine.idea.action ? ` → ${mine.idea.action}` : ""}${mine.idea.outcome ? ` → ${mine.idea.outcome}` : ""}` : "",
    `Post title: ${post.title}`,
    `Post:\n${post.body}`,
    "",
    `Formats to make: ${wanted.map((f) => `${f} (${FORMAT_META[f].label}: ${FORMAT_META[f].blurb})`).join("; ")}`,
    `Channels this will go out on: ${chans.map((c) => `${platformOrNull(c.platform)?.name ?? c.platform} ${c.handle}`).join(", ") || "none yet"}`,
    rules.length ? "\nPlaybook for these formats:" : "",
    ...rules.map((r) => {
      const limits = describeRule(r).filter((l) => /^(Title|Hashtags|Copy|Words|Emoji|First line|Ending|Include|Never write|Disclosure|Length|Media):/.test(l));
      return [`- ${r.name}: ${r.instructions}`, r.brandNotes ? `  For this brand: ${r.brandNotes}` : "", limits.length ? `  Limits: ${limits.join("; ")}` : ""].filter(Boolean).join("\n");
    }),
  ].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n").trim();

  const api = client();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: MODELS.writing };
  const source = opts.source ?? "versions";
  try {
    const res = await api.beta.messages.parse({
      model: MODELS.writing,
      max_tokens: 16_000,
      ...fallbackFor(MODELS.writing),
      output_config: { effort: "medium", format: betaZodOutputFormat(VersionsSchema) },
      system: [
        { type: "text", text: SYSTEM },
        { type: "text", text: brandBook(brand), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: lines }] as Anthropic.Beta.BetaMessageParam[],
    } satisfies Parameters<Anthropic["beta"]["messages"]["parse"]>[0]);
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
    usage.model = res.model;
    if (res.stop_reason === "refusal") throw new DraftingError("Claude declined to make these versions.");
    if (res.stop_reason === "max_tokens") throw new DraftingError("The versions ran out of room. Try fewer formats.");
    if (!res.parsed_output) throw new DraftingError("Claude's answer could not be read. Try again.");
    await recordUsage(brand.id, source, usage);

    const out = res.parsed_output;
    const made: ContentFormat[] = [];
    for (const v of out.versions) {
      if (!wanted.includes(v.format) || made.includes(v.format)) continue;
      const row = {
        title: v.title, body: v.body, outline: v.outline, script: v.script,
        status: "drafted" as const, agentCode: opts.agentCode ?? null, updatedAt: new Date(),
      };
      await db.insert(postVersions).values({ postId, format: v.format, ...row })
        .onConflictDoUpdate({ target: [postVersions.postId, postVersions.format], set: row });
      made.push(v.format);
    }
    await assignVersions(postId);
    return { made, issues: checkVersions(out, brand), note: out.note };
  } catch (err) {
    if (usage.input + usage.output > 0) await recordUsage(brand.id, source, usage);
    explain(err);
  }
}

/* -------------------------------------------------------------- assignment */

/**
 * Points each channel at the version that suits it best, among the versions
 * that exist. A channel a person already pointed somewhere keeps its choice
 * unless `reset` is set. Returns how many channels changed.
 */
export async function assignVersions(postId: string, opts: { reset?: boolean } = {}) {
  const { targets, chans } = await postChannels(postId);
  const versions = await versionsForPost(postId);
  if (versions.length === 0 || targets.length === 0) return 0;
  let changed = 0;
  for (const t of targets) {
    if (t.status === "published" || (t.versionId && !opts.reset)) continue;
    const ch = chans.find((c) => c.id === t.channelId);
    if (!ch) continue;
    const format = pickFormat(ch.platform, platformOrNull(ch.platform)?.category ?? null, versions.map((v) => v.format as ContentFormat));
    const version = versions.find((v) => v.format === format);
    if (!version || version.id === t.versionId) continue;
    await db.update(postTargets).set({
      versionId: version.id,
      // The platform's own format switch (an Instagram reel, an X thread).
      options: { ...(t.options ?? {}), ...versionOptions(ch.platform, version.format as ContentFormat) },
    }).where(eq(postTargets.id, t.id));
    changed++;
  }
  return changed;
}

/** What actually goes out on a target: its own override, else its version, else the post. */
export function publishBody(
  target: { bodyOverride: string | null },
  version: { format: string; body: string; outline: string[] } | null,
  post: { body: string },
) {
  if (target.bodyOverride) return target.bodyOverride;
  if (version) return versionPublishText({ format: version.format as ContentFormat, body: version.body, outline: version.outline });
  return post.body;
}

/* ------------------------------------------------------------ the post page */

/** Everything the formats panel on a post's page shows. */
export async function versionPanelData(postId: string, brandId: string) {
  const [versions, chans] = await Promise.all([
    versionsForPost(postId),
    db.select().from(channels).where(and(eq(channels.brandId, brandId), isNull(channels.archivedAt))).orderBy(asc(channels.platform), asc(channels.handle)),
  ]);
  const mediaIds = [...new Set(versions.flatMap((v) => v.mediaIds))];
  const items = mediaIds.length ? await db.select().from(media).where(inArray(media.id, mediaIds)) : [];
  return {
    versions: versions.map((v) => ({
      id: v.id, format: v.format as ContentFormat, title: v.title, body: v.body, outline: v.outline, script: v.script,
      status: v.status, byAgent: Boolean(v.agentCode),
      media: v.mediaIds.map((id) => items.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({ url: m.url, kind: m.kind })),
    })),
    channels: chans.map((c) => {
      const p = platformOrNull(c.platform);
      return {
        id: c.id, platform: c.platform, handle: c.handle, category: p?.category ?? null,
        avatarUrl: c.avatarUrl, textMax: p?.constraints.textMax ?? 0,
      };
    }),
  };
}
