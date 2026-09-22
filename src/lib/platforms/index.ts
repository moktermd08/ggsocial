// Mainstream social
import { instagram } from "./adapters/instagram";
import { facebook } from "./adapters/facebook";
import { threads } from "./adapters/threads";
import { linkedin } from "./adapters/linkedin";
import { x } from "./adapters/x";
import { pinterest } from "./adapters/pinterest";
import { reddit } from "./adapters/reddit";
// Open / federated social
import { bluesky } from "./adapters/bluesky";
import { mastodon } from "./adapters/mastodon";
import { tumblr } from "./adapters/tumblr";
import { vk } from "./adapters/vk";
import { farcaster } from "./adapters/farcaster";
// Messaging & broadcast
import { telegram } from "./adapters/telegram";
import { whatsapp } from "./adapters/whatsapp";
import { messenger } from "./adapters/messenger";
import { discord } from "./adapters/discord";
import { slack } from "./adapters/slack";
import { line } from "./adapters/line";
import { viber } from "./adapters/viber";
// Video & live
import { tiktok } from "./adapters/tiktok";
import { youtube } from "./adapters/youtube";
import { vimeo } from "./adapters/vimeo";
import { dailymotion } from "./adapters/dailymotion";
import { twitch } from "./adapters/twitch";
// Publishing
import { wordpress } from "./adapters/wordpress";
import { ghost } from "./adapters/ghost";
import { webflow } from "./adapters/webflow";
import { shopifyBlog } from "./adapters/shopify-blog";
import { devto } from "./adapters/devto";
import { hashnode } from "./adapters/hashnode";
import { notion } from "./adapters/notion";
// Communities
import { discourse } from "./adapters/discourse";
import { lemmy } from "./adapters/lemmy";
// Email, SMS & push
import { beehiiv } from "./adapters/beehiiv";
import { mailchimp } from "./adapters/mailchimp";
import { brevo } from "./adapters/brevo";
import { convertkit } from "./adapters/convertkit";
import { klaviyo } from "./adapters/klaviyo";
import { resend } from "./adapters/resend";
import { sendgrid } from "./adapters/sendgrid";
import { twilioSms } from "./adapters/twilio-sms";
import { onesignal } from "./adapters/onesignal";
// Local & developer
import { googleBusiness } from "./adapters/google-business";
import { github } from "./adapters/github";
// Escape hatch
import { webhook } from "./adapters/webhook";
// Everything without a usable write API
import { MANUAL_PLATFORMS } from "./adapters/_catalog";

import { CATEGORY_ORDER, type MediaItem, type Platform, type PlatformCategory, type PlatformId, type ValidationIssue } from "./types";

/** Channels ggsocial can publish to by itself once credentials are in place. */
const API_PLATFORMS = {
  instagram, facebook, linkedin, x, threads, pinterest, reddit,
  bluesky, mastodon, tumblr, vk, farcaster,
  telegram, whatsapp, messenger, discord, slack, line, viber,
  tiktok, youtube, vimeo, dailymotion, twitch,
  wordpress, ghost, webflow, shopify_blog: shopifyBlog, devto, hashnode, notion,
  discourse, lemmy,
  beehiiv, mailchimp, brevo, convertkit, klaviyo, resend, sendgrid,
  twilio_sms: twilioSms, onesignal,
  google_business: googleBusiness, github,
  webhook,
};

export const PLATFORMS: Record<PlatformId, Platform> = { ...API_PLATFORMS, ...MANUAL_PLATFORMS };

export const PLATFORM_LIST = Object.values(PLATFORMS);

/**
 * Platforms with no public page of their own to visit: senders and inboxes
 * whose audience is a list or a conversation, not a page someone can open.
 * The daily page check skips these channels rather than asking every day for
 * a URL that does not exist.
 */
const NO_PUBLIC_PAGE = new Set<string>([
  "messenger", "whatsapp", "slack", "discord", "line", "viber", "zalo", "kakao", "wechat",
  "webhook", "facebook_marketplace",
]);

export function hasPublicPage(platformId: string) {
  const p = platformOrNull(platformId);
  // Email, SMS and push send to a list; the rest are named one by one above.
  return !!p && p.category !== "email" && p.category !== "automation" && !NO_PUBLIC_PAGE.has(p.id);
}

/** Platforms that can auto-publish, best-first within each category. */
export const LIVE_PLATFORM_LIST = PLATFORM_LIST.filter((p) => !p.manualOnly);

export const PLATFORMS_BY_CATEGORY: { category: PlatformCategory; platforms: Platform[] }[] =
  CATEGORY_ORDER.map((category) => ({
    category,
    platforms: PLATFORM_LIST
      .filter((p) => p.category === category)
      // Auto-publishing channels first, then alphabetical — the useful ones surface.
      .sort((a, b) => Number(Boolean(a.manualOnly)) - Number(Boolean(b.manualOnly)) || a.name.localeCompare(b.name)),
  })).filter((g) => g.platforms.length > 0);

export function getPlatform(id: string): Platform {
  const p = PLATFORMS[id as PlatformId];
  if (!p) throw new Error(`Unknown platform: ${id}`);
  return p;
}

/** Safe lookup for rendering data that may reference a removed platform. */
export function platformOrNull(id: string): Platform | null {
  return PLATFORMS[id as PlatformId] ?? null;
}

/**
 * Generic constraint checks plus the platform's own rules.
 * Errors block scheduling; warnings are advisory.
 */
export function validateTarget(args: {
  platformId: string;
  body: string;
  media: MediaItem[];
  options: Record<string, unknown>;
}): ValidationIssue[] {
  const p = platformOrNull(args.platformId);
  if (!p) return [{ level: "error", message: `Unsupported platform "${args.platformId}".` }];
  const c = p.constraints;
  const issues: ValidationIssue[] = [];

  if (args.body.length > c.textMax) {
    issues.push({ level: "error", message: `${args.body.length} characters — ${p.name} allows ${c.textMax}.` });
  }
  if (c.requiresMedia && args.media.length < Math.max(1, c.mediaMin)) {
    issues.push({ level: "error", message: `${p.name} requires at least ${Math.max(1, c.mediaMin)} media file.` });
  }
  if (c.mediaMax !== null && args.media.length > c.mediaMax) {
    issues.push({ level: "error", message: `${args.media.length} files attached — ${p.name} allows ${c.mediaMax}.` });
  }
  for (const m of args.media) {
    if (!c.allowedMedia.includes(m.kind)) {
      issues.push({ level: "error", message: `${p.name} does not accept ${m.kind} files (${m.originalName}).` });
    }
    if (c.videoMaxSeconds && m.kind === "video" && m.durationMs && m.durationMs / 1000 > c.videoMaxSeconds) {
      issues.push({ level: "error", message: `${m.originalName} is longer than ${p.name}'s ${c.videoMaxSeconds}s limit.` });
    }
  }
  for (const f of p.optionFields) {
    if (f.required && !String(args.options[f.key] ?? "").trim()) {
      issues.push({ level: "error", message: `${p.name}: "${f.label}" is required.` });
    }
  }
  if (!args.body.trim() && args.media.length === 0) {
    issues.push({ level: "error", message: `${p.name} post is empty.` });
  }
  return [...issues, ...(p.validate?.({ body: args.body, media: args.media, options: args.options }) ?? [])];
}

/** Option defaults for a newly added channel target. */
export function defaultOptions(platformId: string): Record<string, unknown> {
  const p = platformOrNull(platformId);
  if (!p) return {};
  return Object.fromEntries(
    p.optionFields.filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]),
  );
}

export * from "./types";
