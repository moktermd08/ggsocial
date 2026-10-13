import "server-only";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, brands, channels, postTargets, postVersions, posts } from "@/lib/db";
import { checkTargets, type EffectiveRule } from "@/lib/playbook/check";
import { getBrandPlaybook } from "@/server/playbook";
import { contentHash, stampApproval } from "@/server/approval";
import { formatLifts } from "@/server/performance";
import { defaultOptions, platformOrNull, validateTarget, type MediaItem } from "@/lib/platforms";
import {
  FORMAT_META, formatsForPlatform, versionOptions, versionPublishText, type ContentFormat,
} from "@/lib/formats";
import { publishBody } from "@/server/versions";
import { attachmentRows, mediaForTarget, versionMediaItems } from "@/server/target-media";

/**
 * Format versions are written for every format a post's channels could carry.
 * Which one a channel really goes out as depends on what can be delivered: a
 * reel needs a video, a carousel needs slides, a thread needs each part to fit.
 * An agent cannot ask a person which to use, so for each channel it walks the
 * platform's formats best-first and adopts the first one that fits the
 * platform's limits and has the media it needs, falling back to the plain post.
 * What a channel will send is then the version's text, never a mix of one
 * format's caption and another's media.
 */

const UNSENT = ["pending", "scheduled", "failed"] as const;

/** Why a version cannot go out on this channel with this media, or null when it can. */
export function whyNotFit(
  version: { format: string; body: string; outline: string[] },
  platformId: string,
  options: Record<string, unknown>,
  media: MediaItem[],
): string | null {
  const platform = platformOrNull(platformId);
  if (!platform) return `${platformId} is not a known platform.`;
  const format = version.format as ContentFormat;
  const meta = FORMAT_META[format];
  if (!meta) return `Unknown format ${version.format}.`;
  const images = media.filter((m) => m.kind === "image").length;
  const videos = media.filter((m) => m.kind === "video").length;

  if (meta.needsMedia === "video" && videos === 0) return `A ${meta.label.toLowerCase()} needs a video, and none is attached.`;
  if (format === "carousel") {
    if (images < 2) return `A carousel needs at least two images; ${images} attached.`;
    if (videos > 0) return "A carousel takes images only.";
  } else if (meta.needsMedia === "image" && images + videos === 0) {
    return `A ${meta.label.toLowerCase()} needs an image, and none is attached.`;
  }

  const merged = { ...options, ...versionOptions(platformId, format) };
  const body = versionPublishText({ format, body: version.body, outline: version.outline });
  // The media rules of validateTarget are about whether a post can be sent at all; "needs media" is the hold's business.
  const errors = validateTarget({ platformId, body, media, options: merged })
    .filter((i) => i.level === "error" && !/requires at least|post is empty/.test(i.message));
  return errors[0]?.message ?? null;
}

/**
 * The playbook's must-rules for the format, applied to this version's own
 * text and the media it would go out with. A version that breaks one is not
 * adopted: the channel would only stop for a person at the next step.
 */
function playbookBreaks(
  rules: EffectiveRule[], timezone: string, post: { title: string },
  version: { format: string; body: string; outline: string[] }, channelId: string, platformId: string,
  options: Record<string, unknown>, media: MediaItem[],
): string | null {
  const text = versionPublishText({ format: version.format as ContentFormat, body: version.body, outline: version.outline });
  const [check] = checkTargets(rules, {
    title: post.title, body: text, postType: version.format, scheduledAt: null, timezone,
    media: media as never,
    targets: [{ channelId, platform: platformId, bodyOverride: text, options, format: version.format }],
  });
  const error = check?.issues.find((i) => i.level === "error");
  return error ? `${check.rule?.name ?? "Playbook"}: ${error.message}` : null;
}

/**
 * The order a channel's formats are tried in. The platform's own order is the
 * default: formats it ranks above the plain post come first. Where this brand's
 * numbers show one format doing clearly better on the platform, it goes ahead
 * of the rest, even one the platform ranks below the post. The plain post is
 * always the last resort.
 */
export function orderLadder<T extends { format: string }>(preferred: T[], platform: string, lifts: Map<string, number>): T[] {
  const floorAt = preferred.findIndex((v) => v.format === "post");
  const lift = (v: T) => lifts.get(`${platform}:${v.format}`) ?? 1;
  const rich = preferred.filter((v, i) => v.format !== "post" && (floorAt < 0 || i < floorAt || lift(v) >= 1.25));
  const tail = floorAt < 0 ? [] : preferred.filter((v) => v.format === "post");
  return [...rich].sort((a, b) => lift(b) - lift(a)).concat(tail);
}

export type Settled = { channel: string; chose: string; note?: string };

/**
 * Chooses, for each unsent channel of an agent's post, the format it goes out
 * as. Safe to run again whenever the media changes. Posts a person wrote are
 * left to the person.
 */
export async function settleFormats(postId: string): Promise<Settled[]> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post?.agentCode) return [];
  // Choosing a format is the system's call, not an edit: an approval that held before still holds after.
  const approved = Boolean(post.approvedHash) && post.approvedHash === (await contentHash(postId));
  const out = await settle(postId, post);
  if (approved) await stampApproval(postId);
  return out;
}

async function settle(postId: string, post: typeof posts.$inferSelect): Promise<Settled[]> {
  const [targets, versions, rows] = await Promise.all([
    db.select({ target: postTargets, channel: channels }).from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(eq(postTargets.postId, postId), inArray(postTargets.status, [...UNSENT]))),
    db.select().from(postVersions).where(eq(postVersions.postId, postId)),
    attachmentRows(postId),
  ]);
  if (versions.length === 0) return [];
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, post.brandId) });
  const rules = await getBrandPlaybook(post.brandId);
  const lifts = await formatLifts(post.brandId);

  const out: Settled[] = [];
  for (const { target, channel } of targets) {
    const platform = platformOrNull(channel.platform);
    const base = { ...defaultOptions(channel.platform), ...(channel.settings ?? {}) };
    const preferred = formatsForPlatform(channel.platform, platform?.category ?? null)
      .map((f) => versions.find((v) => v.format === f))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
    const ladder = orderLadder(preferred, channel.platform, lifts);

    let chosen: (typeof versions)[number] | null = null;
    const skipped: string[] = [];
    for (const v of ladder) {
      // The plain post is the floor: it is always allowed, and keeps the channel's tuned copy.
      if (v.format === "post") break;
      const media = mediaForTarget(rows, target.id, await versionMediaItems(v.mediaIds));
      const opts = { ...base, ...(target.options ?? {}), ...versionOptions(channel.platform, v.format as ContentFormat) };
      const why = whyNotFit(v, channel.platform, { ...base, ...(target.options ?? {}) }, media)
        ?? playbookBreaks(rules, brand?.timezone ?? "UTC", post, v, channel.id, channel.platform, opts, media);
      if (!why) { chosen = v; break; }
      skipped.push(`${FORMAT_META[v.format as ContentFormat].label}: ${why}`);
    }
    const floor = versions.find((v) => v.format === "post") ?? null;
    const pick = chosen ?? floor;

    // Option switches that a format turns on (an Instagram reel, an X thread) follow the choice.
    const switches = new Set(versions.flatMap((v) => Object.keys(versionOptions(channel.platform, v.format as ContentFormat))));
    const options: Record<string, unknown> = { ...(target.options ?? {}) };
    for (const k of switches) options[k] = base[k] ?? undefined;
    Object.assign(options, chosen ? versionOptions(channel.platform, chosen.format as ContentFormat) : {});
    for (const k of Object.keys(options)) if (options[k] === undefined) delete options[k];

    const changed = target.versionId !== (pick?.id ?? null) || target.useVersion !== Boolean(chosen)
      || JSON.stringify(target.options ?? {}) !== JSON.stringify(options);
    if (changed) {
      await db.update(postTargets).set({ versionId: pick?.id ?? null, useVersion: Boolean(chosen), options })
        .where(eq(postTargets.id, target.id));
    }
    out.push({
      channel: platform?.name ?? channel.platform,
      chose: chosen ? FORMAT_META[chosen.format as ContentFormat].label : "Text post",
      note: !chosen && skipped.length ? `goes out as a plain post. ${skipped[0]}` : undefined,
    });
  }
  return out;
}

/**
 * What would be refused by the platform if sent as it stands: each unsent
 * channel's real text (its version's, if adopted) and real media, held to the
 * platform's limits. Channels still waiting for their media are left out;
 * that wait is handled on its own.
 */
export async function platformLimitProblems(postId: string, skipTargetIds: string[] = []) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return [];
  const [targets, versions, rows] = await Promise.all([
    db.select({ target: postTargets, channel: channels }).from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId))
      .where(and(eq(postTargets.postId, postId), inArray(postTargets.status, [...UNSENT]),
        skipTargetIds.length ? notInArray(postTargets.id, skipTargetIds) : undefined)),
    db.select().from(postVersions).where(eq(postVersions.postId, postId)),
    attachmentRows(postId),
  ]);
  const problems: string[] = [];
  for (const { target, channel } of targets) {
    const version = versions.find((v) => v.id === target.versionId) ?? null;
    const body = publishBody(target, version, post);
    const media = mediaForTarget(rows, target.id, version ? await versionMediaItems(version.mediaIds) : null);
    let issues = validateTarget({ platformId: channel.platform, body, media, options: (target.options ?? {}) as Record<string, unknown> })
      .filter((i) => i.level === "error");
    // A platform that names the part that is too long (X threads) has already said it; the generic line repeats it.
    if (issues.some((i) => /^Part \d+ is/.test(i.message))) issues = issues.filter((i) => !/characters — .* allows/.test(i.message));
    for (const i of issues) problems.push(`${platformOrNull(channel.platform)?.name ?? channel.platform}: ${i.message}`);
  }
  return [...new Set(problems)];
}
