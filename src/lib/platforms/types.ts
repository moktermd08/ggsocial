import type { brands, channels, media, posts, postTargets } from "@/lib/db";

/** Buckets used to group the (large) platform roster in the UI. */
export type PlatformCategory =
  | "social" | "messaging" | "video" | "blog" | "community"
  | "email" | "local" | "commerce" | "dev" | "regional" | "automation";

export const CATEGORY_LABELS: Record<PlatformCategory, string> = {
  social: "Social networks",
  messaging: "Messaging & broadcast",
  video: "Video, audio & live",
  blog: "Publishing & blogs",
  community: "Communities & forums",
  email: "Email, SMS & push",
  local: "Local, maps & reviews",
  commerce: "Marketplaces & classifieds",
  dev: "Developer, design & directories",
  regional: "Regional platforms",
  automation: "Automation & custom",
};

export const CATEGORY_ORDER: PlatformCategory[] = [
  "social", "messaging", "video", "blog", "community",
  "email", "local", "commerce", "dev", "regional", "automation",
];

export type PlatformId =
  // social
  | "instagram" | "facebook" | "linkedin" | "x" | "threads" | "pinterest" | "reddit"
  | "bluesky" | "mastodon" | "tumblr" | "vk" | "farcaster" | "lemmy"
  | "snapchat" | "nextdoor" | "facebook_group" | "instagram_broadcast"
  // messaging
  | "telegram" | "whatsapp" | "whatsapp_channel" | "messenger" | "discord" | "slack"
  | "line" | "viber" | "twilio_sms" | "onesignal"
  // video / audio
  | "youtube" | "tiktok" | "vimeo" | "dailymotion" | "twitch" | "youtube_community"
  | "rumble" | "kick" | "soundcloud" | "spotify_podcast" | "apple_podcast" | "restream"
  // publishing
  | "wordpress" | "ghost" | "webflow" | "shopify_blog" | "devto" | "hashnode"
  | "beehiiv" | "notion" | "medium" | "substack" | "slideshare" | "issuu" | "flipboard"
  // community
  | "discourse" | "quora" | "hacker_news" | "indie_hackers" | "skool" | "circle" | "mighty_networks"
  // email
  | "mailchimp" | "brevo" | "convertkit" | "klaviyo" | "resend" | "sendgrid"
  // local
  | "google_business" | "apple_business" | "bing_places" | "yelp" | "tripadvisor"
  | "trustpilot" | "g2" | "capterra" | "clutch"
  // commerce
  | "facebook_marketplace" | "etsy" | "ebay" | "amazon_posts" | "olx" | "craigslist"
  | "gumtree" | "bikroy" | "daraz" | "gumroad"
  // dev / design / directories
  | "github" | "product_hunt" | "behance" | "dribbble" | "figma_community"
  | "alternativeto" | "betalist" | "saashub" | "crunchbase" | "wellfound"
  | "upwork" | "fiverr" | "glassdoor"
  // regional
  | "wechat" | "weibo" | "douyin" | "xiaohongshu" | "kuaishou" | "bilibili" | "zhihu"
  | "naver" | "kakao" | "zalo" | "sharechat"
  // automation
  | "webhook";

export type MediaKind = "image" | "video" | "document";

/** A field the composer renders for this platform's per-channel options. */
export type OptionField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "boolean" | "number";
  required?: boolean;
  choices?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  defaultValue?: string | number | boolean;
};

export type Constraints = {
  textMax: number;
  /** null = no hard cap enforced by us. */
  mediaMax: number | null;
  mediaMin: number;
  allowedMedia: MediaKind[];
  videoMaxSeconds?: number;
  requiresMedia?: boolean;
  supportsFirstComment?: boolean;
  supportsLinks?: boolean;
  /** Hashtags that actually do something on this platform. */
  hashtagsUseful?: boolean;
  aspectRatioHint?: string;
};

/** An extra secret a platform needs beyond the access token. */
export type CredentialField = {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
};

export type ValidationIssue = { level: "error" | "warn"; message: string };

export type MediaItem = typeof media.$inferSelect;

export type PublishContext = {
  brand: typeof brands.$inferSelect;
  channel: typeof channels.$inferSelect;
  post: typeof posts.$inferSelect;
  target: typeof postTargets.$inferSelect;
  /** Final copy after applying the target override. */
  body: string;
  firstComment?: string | null;
  media: MediaItem[];
  options: Record<string, unknown>;
  /** Absolute, publicly reachable URL for a stored media item. */
  publicUrl: (m: MediaItem) => string;
  credentials: Record<string, string> | null;
};

export type PublishResult = {
  externalId?: string;
  externalUrl?: string;
  note?: string;
};

export type MetricsResult = {
  impressions?: number;
  reach?: number;
  likes?: number;
  commentCount?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  videoViews?: number;
  raw?: Record<string, unknown>;
};

export type ManualStep = { label: string; detail?: string; copy?: string };

export type Platform = {
  id: PlatformId;
  name: string;
  color: string;
  category: PlatformCategory;
  /** Short description shown on the Channels page. */
  blurb: string;
  /**
   * True when the platform has no usable write API for this kind of content.
   * These channels stay in manual mode: the app still composes, validates,
   * schedules and queues the post with copy-ready blocks for a person.
   */
  manualOnly?: boolean;
  constraints: Constraints;
  optionFields: OptionField[];
  /** What the user has to obtain before `mode: "live"` can work. */
  liveSetup: {
    docsUrl: string;
    envKeys: string[];
    requiresAppReview: boolean;
    notes: string;
    /** Overrides the generic "Access token" label when the platform calls it something else. */
    tokenLabel?: string;
  };
  /** Secrets beyond the access token, rendered on the Connect form. */
  credentialFields?: CredentialField[];
  /** Extra checks beyond the generic length/media rules. */
  validate?: (ctx: { body: string; media: MediaItem[]; options: Record<string, unknown> }) => ValidationIssue[];
  /** Steps shown in the publish queue when the channel is in manual mode. */
  manualSteps?: (ctx: PublishContext) => ManualStep[];
  publish: (ctx: PublishContext) => Promise<PublishResult>;
  fetchMetrics?: (ctx: { channel: typeof channels.$inferSelect; externalPostId: string; credentials: Record<string, string> | null }) => Promise<MetricsResult>;
  /** Account-level numbers for a live channel, read daily so goals can track them. */
  fetchAccountStats?: (ctx: { channel: typeof channels.$inferSelect; credentials: Record<string, string> | null }) => Promise<AccountStats>;
  /**
   * New comments, mentions and messages for a live channel, newest first.
   * `posts` are the platform ids of what the brand published recently, for
   * platforms that only list comments per post. Items from the brand's own
   * account are left out.
   */
  fetchInbound?: (ctx: { channel: typeof channels.$inferSelect; credentials: Record<string, string> | null; since: Date; posts: string[] }) => Promise<InboundItem[]>;
  /** Posts a reply to one inbound item, by the id `fetchInbound` gave it. */
  sendReply?: (ctx: { channel: typeof channels.$inferSelect; credentials: Record<string, string> | null; replyTo: string; body: string }) => Promise<{ externalId?: string; externalUrl?: string }>;
};

export type AccountStats = { followers?: number };

/** Something someone said to or about the brand on a platform. */
export type InboundItem = {
  externalId: string;
  kind: "comment" | "mention" | "message" | "review";
  body: string;
  authorName?: string | null;
  authorHandle?: string | null;
  authorUrl?: string | null;
  externalUrl?: string | null;
  receivedAt: Date;
  /** The brand's post it was left on, when it was. */
  externalPostId?: string | null;
};

/** Thrown when a live publish is attempted without usable credentials. */
export class NotConnectedError extends Error {
  constructor(platform: string, detail: string) {
    super(`${platform} is not connected: ${detail}`);
    this.name = "NotConnectedError";
  }
}

export async function apiFetch(url: string, init: RequestInit & { label: string }): Promise<Record<string, unknown>> {
  const { label, ...rest } = init;
  const res = await fetch(url, rest);
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const detail = typeof json === "object" && json ? JSON.stringify(json).slice(0, 400) : text.slice(0, 400);
    throw new Error(`${label} failed (${res.status}): ${detail}`);
  }
  return (json ?? {}) as Record<string, unknown>;
}

/** Upload a stored media file's bytes, for APIs that want the raw body. */
export async function fetchMediaBytes(url: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read media (${res.status}) from ${url}`);
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}
