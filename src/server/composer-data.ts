import "server-only";
import { inArray } from "drizzle-orm";
import { db, media } from "@/lib/db";
import { getBrandChannels } from "./queries";
import { platformMeta } from "@/lib/platforms/meta";
import type { BrandWithRole } from "@/lib/auth";
import type { ComposerBrand, ComposerChannel, ComposerMedia } from "@/components/composer";

/** Everything the composer needs for the brands a user can write to. */
export async function getComposerData(brands: BrandWithRole[]) {
  const ids = brands.map((b) => b.id);
  const channels = await getBrandChannels(ids);
  const mediaRows = ids.length ? await db.select().from(media).where(inArray(media.brandId, ids)) : [];

  const channelsByBrand: Record<string, ComposerChannel[]> = {};
  for (const c of channels) {
    (channelsByBrand[c.brandId] ??= []).push({
      id: c.id, platform: c.platform, handle: c.handle, displayName: c.displayName, mode: c.mode,
    });
  }

  const mediaByBrand: Record<string, ComposerMedia[]> = {};
  for (const m of [...mediaRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    (mediaByBrand[m.brandId] ??= []).push({ id: m.id, url: m.url, kind: m.kind, originalName: m.originalName });
  }

  const composerBrands: ComposerBrand[] = brands.map((b) => ({
    id: b.id, name: b.name, color: b.color, timezone: b.timezone,
    brief: b.brief, voice: b.voice, audience: b.audience, ctaText: b.ctaText,
    valueProps: b.valueProps, bannedWords: b.bannedWords,
    defaultHashtags: b.defaultHashtags, emojiPolicy: b.emojiPolicy,
  }));

  return { composerBrands, channelsByBrand, mediaByBrand, platforms: platformMeta() };
}
