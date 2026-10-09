/**
 * What "registered on a platform" means, and what a registration is made of.
 * Client-safe: no database.
 *
 * A brand is registered on a platform when it has a live (not archived)
 * channel there. If it does, nothing is done. If it does not, a registration
 * run follows the playbook's "Registering on a new platform" rule from the
 * brand page's own words, never retyped ones.
 */
import type { brands } from "@/lib/db/schema";
import { checkBrandDetails, mainHandle, normalHandle, profileCopy, type DetailIssue } from "@/lib/brand-details";

type Brand = typeof brands.$inferSelect;
export type ChannelLike = { platform: string; handle: string; archivedAt?: Date | null };

/**
 * The brand page fields every sign-up form asks for. Anything wrong ("fix") on
 * the page blocks registering; a gap ("fill") blocks only if the form needs it.
 */
const NEEDED = new Set([
  "Name", "Legal name", "Tagline", "Website", "Contact email", "Industry", "Headquarters",
  "What the company does", "Primary logo", "Icon / mark",
]);

/** What must be put right on the brand page before any registration, per the rule "Brand details check passed first". */
export function registrationBlockers(b: Brand, channels: ChannelLike[]): DetailIssue[] {
  const live = channels.filter((c) => !c.archivedAt);
  return checkBrandDetails(b, live).filter((i) => i.level === "fix" || NEEDED.has(i.field));
}

/** Platforms the brand has a live channel on. */
export function registeredPlatforms(channels: ChannelLike[]) {
  return new Set(channels.filter((c) => !c.archivedAt).map((c) => c.platform));
}

/** Platforms whose only channel was archived on purpose: not registered again behind anyone's back. */
export function removedPlatforms(channels: ChannelLike[]) {
  const live = registeredPlatforms(channels);
  return new Set(channels.filter((c) => c.archivedAt && !live.has(c.platform)).map((c) => c.platform));
}

/** The values for one sign-up form, with the handle every other channel uses. */
export function registrationPack(b: Brand, channels: ChannelLike[]) {
  const live = channels.filter((c) => !c.archivedAt);
  const handle = mainHandle(live);
  return {
    handle: handle ? `@${handle}` : null,
    fields: profileCopy(b, live),
    logoIcon: b.logoIconUrl,
    logo: b.logoUrl,
  };
}

/** True when a channel's handle differs from the one most channels use. */
export function offHandle(handle: string, channels: ChannelLike[]) {
  const main = mainHandle(channels.filter((c) => !c.archivedAt));
  const h = normalHandle(handle);
  return !!main && h !== null && h !== main;
}
