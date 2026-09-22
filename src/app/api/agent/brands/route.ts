import { and, inArray, isNull } from "drizzle-orm";
import { db, channels } from "@/lib/db";
import { EMOJI_LABELS } from "@/lib/brand-book";
import { platformOrNull } from "@/lib/platforms";
import type { BrandWithRole } from "@/lib/auth";
import { pickBrands, withAgent } from "@/server/agent-api";

/**
 * Each brand's voice, so drafts sound like the brand: the brand book (the
 * master book's values are already synced into each brand), the company
 * profile, and every channel with the limits its platform writes to.
 *
 *   GET /api/agent/brands?brand=all
 *
 * `writingGuide` is the same rules as one block of text, ready to follow.
 * Internal brand notes are never returned.
 */
export async function GET(req: Request) {
  return withAgent(req, async ({ brands }) => {
    const picked = pickBrands(brands, new URL(req.url).searchParams.get("brand"));
    const channelRows = picked.length
      ? await db.select({ brandId: channels.brandId, platform: channels.platform, handle: channels.handle, mode: channels.mode })
          .from(channels)
          .where(and(inArray(channels.brandId, picked.map((b) => b.id)), isNull(channels.archivedAt)))
          .orderBy(channels.platform, channels.handle)
      : [];

    return {
      brands: picked.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        role: b.role,
        timezone: b.timezone,
        website: b.website,
        tagline: b.tagline,
        description: b.description,
        industry: b.industry,
        voice: {
          brief: b.brief,
          tone: b.voice,
          audience: b.audience,
          keyMessages: b.valueProps,
          wordsToAvoid: b.bannedWords,
          hashtags: b.defaultHashtags,
          emoji: b.emojiPolicy,
          callToAction: b.ctaText,
          boilerplate: b.boilerplate,
          imageStyle: b.imageStyle,
          links: b.links,
        },
        channels: channelRows.filter((c) => c.brandId === b.id).map((c) => {
          const p = platformOrNull(c.platform);
          return {
            platform: c.platform,
            platformName: p?.name ?? c.platform,
            handle: c.handle,
            publishing: c.mode === "live" ? "auto" : "by a person",
            maxCharacters: p?.constraints.textMax ?? null,
            linksClickable: p?.constraints.supportsLinks ?? null,
            hashtagsUseful: p?.constraints.hashtagsUseful ?? null,
            aspectRatio: p?.constraints.aspectRatioHint ?? null,
          };
        }),
        writingGuide: writingGuide(b),
      })),
    };
  });
}

/** The brand book as instructions, skipping anything the brand has not filled in. */
function writingGuide(b: BrandWithRole) {
  const lines = [
    `Write as ${b.name}${b.tagline ? ` — ${b.tagline.trim().replace(/[.!?]+$/, "")}` : ""}.`,
    b.description && `What the company does: ${b.description}`,
    b.brief && `Brief: ${b.brief}`,
    b.voice && `Tone of voice: ${b.voice}`,
    b.audience && `Audience: ${b.audience}`,
    b.valueProps.length > 0 && `Key messages: ${b.valueProps.join("; ")}`,
    b.bannedWords.length > 0 && `Never use these words: ${b.bannedWords.join(", ")}`,
    `Emoji: ${EMOJI_LABELS[b.emojiPolicy]}.`,
    b.defaultHashtags.length > 0 && `Hashtags to draw on: ${b.defaultHashtags.join(" ")}`,
    b.ctaText && `Default call to action: ${b.ctaText}`,
    b.boilerplate && `Boilerplate: ${b.boilerplate}`,
    b.imageStyle && `Image style: ${b.imageStyle}`,
    b.links.length > 0 && `Links: ${b.links.map((l) => `${l.label} ${l.url}`).join(", ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export const dynamic = "force-dynamic";
