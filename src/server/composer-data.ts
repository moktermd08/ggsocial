import "server-only";
import { getBrandChannels } from "./queries";
import { campaignNamesByBrand } from "./campaigns";
import { templateOptionsByBrand } from "./templates";
import { brandLibraries } from "./media-library";
import { getBrandPlaybooks } from "./playbook";
import { platformMeta } from "@/lib/platforms/meta";
import type { BrandWithRole } from "@/lib/auth";
import type { ComposerBrand, ComposerChannel, ComposerMedia } from "@/components/composer";

/** Everything the composer needs for the brands a user can write to. */
export async function getComposerData(brands: BrandWithRole[], userId: string) {
  const ids = brands.map((b) => b.id);
  const channels = await getBrandChannels(ids);

  const channelsByBrand: Record<string, ComposerChannel[]> = {};
  for (const c of channels) {
    (channelsByBrand[c.brandId] ??= []).push({
      id: c.id, platform: c.platform, handle: c.handle, displayName: c.displayName, mode: c.mode,
      settings: (c.settings ?? {}) as Record<string, unknown>,
    });
  }

  // Each brand's own files, then the master assets it has not replaced with a version of its own.
  const libraries = await brandLibraries(userId, ids);
  const mediaByBrand: Record<string, ComposerMedia[]> = {};
  for (const [brandId, items] of libraries) {
    mediaByBrand[brandId] = items.map((m) => ({
      id: m.id, url: m.url, kind: m.kind, originalName: m.originalName, isMaster: m.isMaster,
      width: m.width, height: m.height, durationMs: m.durationMs,
    }));
  }

  const composerBrands: ComposerBrand[] = brands.map((b) => ({
    id: b.id, name: b.name, color: b.color, timezone: b.timezone,
    brief: b.brief, voice: b.voice, audience: b.audience, ctaText: b.ctaText,
    valueProps: b.valueProps, bannedWords: b.bannedWords,
    defaultHashtags: b.defaultHashtags, emojiPolicy: b.emojiPolicy,
    defaultImageUrl: b.defaultImageUrl,
  }));

  const [campaignsByBrand, templatesByBrand, playbooks] = await Promise.all([
    campaignNamesByBrand(ids), templateOptionsByBrand(userId, ids), getBrandPlaybooks(ids),
  ]);

  return {
    composerBrands, channelsByBrand, mediaByBrand, campaignsByBrand, templatesByBrand,
    playbookByBrand: Object.fromEntries(playbooks), platforms: platformMeta(),
  };
}
