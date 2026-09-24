import { and, inArray, isNull } from "drizzle-orm";
import { db, channels } from "@/lib/db";
import { EMOJI_LABELS } from "@/lib/brand-book";
import { platformOrNull } from "@/lib/platforms";
import type { BrandWithRole } from "@/lib/auth";
import { pickBrands, withAgent } from "@/server/agent-api";
import { publicUrl } from "@/server/media";

const abs = (url: string | null) => (url ? publicUrl(url) : null);

/**
 * Each brand's voice, so drafts sound like the brand: the brand book (the
 * master book's values are already synced into each brand), the company
 * profile, the brand's logos and key images, and every channel with the
 * limits its platform writes to.
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
      ? await db.select({ brandId: channels.brandId, platform: channels.platform, handle: channels.handle, mode: channels.mode,
        pageUrl: channels.pageUrl, pageStatus: channels.pageStatus, pageCheckedAt: channels.pageCheckedAt })
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
        products: b.products,
        services: b.services,
        market: {
          segments: b.audienceSegments,
          regions: b.markets,
          /** Context for positioning; never named in a post unless asked. */
          competitors: b.competitors,
        },
        contact: {
          email: b.contactEmail,
          supportEmail: b.supportEmail,
          phone: b.phone,
          contactUrl: b.contactUrl,
          address: b.address,
          openingHours: b.openingHours,
        },
        /** Personal emails are left out: they stay on the brand page. */
        people: b.people.map((p) => ({ name: p.name, role: p.role, bio: p.bio, profileUrl: p.linkedin || null })),
        proof: { points: b.proofPoints, testimonials: b.testimonials, faqs: b.faqs },
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
        /** Absolute URLs; null where the brand has not uploaded one. */
        images: {
          logo: abs(b.logoUrl),
          logoIcon: abs(b.logoIconUrl),
          logoReversed: abs(b.logoReversedUrl),
          socialImage: abs(b.socialImageUrl),
          defaultImage: abs(b.defaultImageUrl),
        },
        channels: channelRows.filter((c) => c.brandId === b.id).map((c) => {
          const p = platformOrNull(c.platform);
          return {
            platform: c.platform,
            platformName: p?.name ?? c.platform,
            handle: c.handle,
            pageUrl: c.pageUrl,
            pageStatus: c.pageUrl ? c.pageStatus ?? "not checked yet" : null,
            pageCheckedAt: c.pageCheckedAt,
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
    b.products.length > 0 && `Products: ${b.products.map((p) => p.name).join(", ")}`,
    b.services.length > 0 && `Services: ${b.services.map((s) => s.name).join(", ")}`,
    b.audienceSegments.length > 0 && `Customer segments: ${b.audienceSegments.map((s) => s.name).join(", ")}`,
    b.competitors.length > 0 && `Never name competitors (${b.competitors.join(", ")}) unless asked.`,
    b.proofPoints.length > 0 && `Claims you can make: ${b.proofPoints.join("; ")}`,
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
