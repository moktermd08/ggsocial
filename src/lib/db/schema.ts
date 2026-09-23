import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  date,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { nanoid } from "nanoid";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => nanoid(16));
const now = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ people */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  createdAt: now(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

/* ------------------------------------------------------------ brands/orgs */

/** A named colour in a brand's palette, beyond the single calendar colour. */
export type BrandColor = { name: string; hex: string };
/** A link a writer might need to hand: site, docs, press kit, app store… */
export type BrandLink = { label: string; url: string };

export const EMOJI_POLICIES = ["free", "sparing", "none"] as const;
export type EmojiPolicy = (typeof EMOJI_POLICIES)[number];

/**
 * The master brand book: the house voice and rules every linked brand starts
 * from. Only the parts that can sensibly be shared live here — identity
 * (name, logo, palette, timezone) is always each brand's own. A linked brand
 * follows each field until it customises it, the same way master posts and
 * campaigns work; see `src/lib/brand-book.ts`. One per author.
 */
export const brandBookDefaults = pgTable("brand_book_defaults", {
  id: id(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  brief: text("brief"),
  voice: text("voice"),
  audience: text("audience"),
  valueProps: jsonb("value_props").$type<string[]>().notNull().default([]),
  bannedWords: jsonb("banned_words").$type<string[]>().notNull().default([]),
  defaultHashtags: jsonb("default_hashtags").$type<string[]>().notNull().default([]),
  emojiPolicy: text("emoji_policy").$type<EmojiPolicy>().notNull().default("free"),
  ctaText: text("cta_text"),
  boilerplate: text("boilerplate"),
  fontHeading: text("font_heading"),
  fontBody: text("font_body"),
  logoUsage: text("logo_usage"),
  imageStyle: text("image_style"),
  links: jsonb("links").$type<BrandLink[]>().notNull().default([]),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("brand_book_defaults_owner_idx").on(t.ownerId)]);

/**
 * One row per company or project you manage.
 *
 * Beyond the handful of fields scheduling needs (colour, timezone), this row is
 * the brand book: identity, visual system, voice and messaging. Everything in
 * the "profile" half is optional — a brand works with just a name — but what is
 * filled in is surfaced to whoever writes for the brand in the composer.
 */
export const brands = pgTable("brands", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  /** Calendar/chip colour. The wider palette lives in `palette`. */
  color: text("color").notNull().default("#6366f1"),
  timezone: text("timezone").notNull().default("UTC"),
  website: text("website"),

  /* -------------------------------------------------------------- identity */
  legalName: text("legal_name"),
  tagline: text("tagline"),
  /** What the company actually does, in a paragraph or two. */
  description: text("description"),
  industry: text("industry"),
  foundedYear: integer("founded_year"),
  hqLocation: text("hq_location"),
  contactEmail: text("contact_email"),

  /* ------------------------------------------------------ visual identity */
  /** The primary logo: the full lockup, used wherever one mark is shown. */
  logoUrl: text("logo_url"),
  /** The icon or mark on its own, for avatars and anywhere too small for the lockup. */
  logoIconUrl: text("logo_icon_url"),
  /** The logo for dark or photographic backgrounds (white or single-colour). */
  logoReversedUrl: text("logo_reversed_url"),
  /** What a shared link to the brand shows (Open Graph / Twitter card, 1200×630). */
  socialImageUrl: text("social_image_url"),
  /** The fallback visual for a post that needs an image and has none of its own. */
  defaultImageUrl: text("default_image_url"),
  /** Named palette entries — primary, accent, ink, and so on. */
  palette: jsonb("palette").$type<BrandColor[]>().notNull().default([]),
  fontHeading: text("font_heading"),
  fontBody: text("font_body"),
  /** Logo dos and don'ts, clear space, which mark to use where. */
  logoUsage: text("logo_usage"),
  imageStyle: text("image_style"),
  /** The Canva folder this brand's designs live in; the Canva import opens there. */
  canvaFolderId: text("canva_folder_id"),

  /* --------------------------------------------------- voice & messaging */
  /** Voice/tone notes, approval rules — shown in the composer. */
  brief: text("brief"),
  voice: text("voice"),
  audience: text("audience"),
  valueProps: jsonb("value_props").$type<string[]>().notNull().default([]),
  /** Words the brand never uses. Flagged in the composer as you type. */
  bannedWords: jsonb("banned_words").$type<string[]>().notNull().default([]),
  /** Offered as one-click inserts in the composer. */
  defaultHashtags: jsonb("default_hashtags").$type<string[]>().notNull().default([]),
  emojiPolicy: text("emoji_policy").$type<EmojiPolicy>().notNull().default("free"),
  ctaText: text("cta_text"),
  boilerplate: text("boilerplate"),

  /* ---------------------------------------------------------------- links */
  links: jsonb("links").$type<BrandLink[]>().notNull().default([]),

  /**
   * How long a comment or message may sit before it counts as late. Reach on
   * every platform rewards a fast first hour, so this is a real target rather
   * than a nicety.
   */
  replySlaMinutes: integer("reply_sla_minutes").notNull().default(60),

  /** Anything else the team needs to know. Never published. */
  notes: text("notes"),

  /** The master brand book this brand follows. null = entirely its own. */
  bookDefaultsId: text("book_defaults_id").references((): AnyPgColumn => brandBookDefaults.id, { onDelete: "set null" }),
  /** The master book's values as of the last sync; see MasterSnapshot on posts. */
  bookSnapshot: jsonb("book_snapshot").$type<Record<string, string>>().notNull().default({}),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [uniqueIndex("brands_slug_idx").on(t.slug)]);

export { ROLES } from "./roles";
import type { Role } from "./roles";
export type { Role };

export const memberships = pgTable("memberships", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  role: text("role").$type<Role>().notNull().default("editor"),
  createdAt: now(),
}, (t) => [uniqueIndex("memberships_user_brand_idx").on(t.userId, t.brandId)]);

/* ----------------------------------------------------------------- channels */

export const CHANNEL_MODES = ["manual", "live"] as const;
export const CHANNEL_STATUSES = ["disconnected", "connected", "error", "expired"] as const;

/** What the last automatic visit to a channel's page found. "unknown" = the site blocked or hid the answer. */
export const PAGE_STATUSES = ["live", "down", "unknown"] as const;

/** A single account on a single platform, owned by one brand. */
export const channels = pgTable("channels", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  /** @handle, page name, subreddit, channel name… */
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  /** "manual" = app prepares the post for you; "live" = app calls the platform API. */
  mode: text("mode").$type<(typeof CHANNEL_MODES)[number]>().notNull().default("manual"),
  status: text("status").$type<(typeof CHANNEL_STATUSES)[number]>().notNull().default("disconnected"),
  /** Platform account id (page id, IG business id, YT channel id…). */
  externalId: text("external_id"),
  /** Encrypted OAuth material. Never selected into the client. */
  credentials: text("credentials"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  /** Per-channel defaults, e.g. default subreddit, YouTube privacy, boards. */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  lastError: text("last_error"),
  /** Public URL of the brand's page on this platform, checked automatically every few hours. */
  pageUrl: text("page_url"),
  pageStatus: text("page_status").$type<(typeof PAGE_STATUSES)[number]>(),
  /** Why the last check came out as it did: "HTTP 404", "title says page not found"… */
  pageNote: text("page_note"),
  pageCheckedAt: timestamp("page_checked_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [index("channels_brand_idx").on(t.brandId)]);

/* -------------------------------------------------------------------- media */

/**
 * One file in a library. Usually a brand's; with no brand it is a master
 * asset, shared by every brand its owner runs. A brand file that points at a
 * master asset is that brand's version of it — the same visual with its own
 * logo, say — and stands in for the master everywhere in that brand,
 * including master-post copies.
 */
export const media = pgTable("media", {
  id: id(),
  /** null = a master asset. */
  brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  /** Who owns a master asset; its library is shared with the brands they admin. */
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  /** Set on a brand file: the master asset this is the brand's version of. */
  masterMediaId: text("master_media_id").references((): AnyPgColumn => media.id, { onDelete: "set null" }),
  kind: text("kind").$type<"image" | "video" | "document">().notNull(),
  url: text("url").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  altText: text("alt_text"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  /** Where the file came from. null = uploaded from disk. */
  source: text("source").$type<IntegrationProvider>(),
  /** Link back to the original, e.g. the Canva editor for a design. */
  sourceUrl: text("source_url"),
  uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
}, (t) => [index("media_brand_idx").on(t.brandId), index("media_master_idx").on(t.masterMediaId)]);

/* ------------------------------------------------------------ integrations */

export const INTEGRATION_PROVIDERS = ["canva", "google_photos"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * A person's own account on a tool that feeds the media library.
 *
 * Unlike channels these belong to a user, not a brand: a Canva login or a
 * Google Photos library is personal, and whoever imports from it chooses which
 * brand the file lands in.
 */
export const integrations = pgTable("integrations", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<IntegrationProvider>().notNull(),
  /** Display name or email of the connected account. */
  accountName: text("account_name"),
  /** Encrypted { accessToken, refreshToken, expiresAt }. Never selected into the client. */
  credentials: text("credentials").notNull(),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("integrations_user_provider_idx").on(t.userId, t.provider)]);

/* ------------------------------------------------------------ content plan */

export { IDEA_STATUSES } from "./idea-status";
import type { IdeaStatus } from "./idea-status";
export type { IdeaStatus };

/**
 * One row of the content plan, above and across the brands.
 *
 * An idea is not a post: it is the thing you want to say, which then fans out
 * into one post per brand — the same insight told as a practitioner, as a
 * product, as a small studio and as an agency. Posts point back here, so the
 * plan can show what actually shipped without anyone retyping it.
 *
 * Ideas belong to the person planning them rather than to a brand, because the
 * whole point is that they cross brands. Sharing a plan with a team is a later
 * problem.
 */
export const contentIdeas = pgTable("content_ideas", {
  id: id(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Position in the plan — the numbering you work down. */
  sequence: integer("sequence").notNull().default(0),
  /** Theme this idea sits under, e.g. "Security & Trust". */
  pillar: text("pillar"),

  /* The three beats every idea in the bank follows. */
  problem: text("problem").notNull(),
  action: text("action"),
  outcome: text("outcome"),
  /** Working title. Blank falls back to the problem line. */
  title: text("title").notNull().default(""),

  /** null = a one-off. A name groups the idea into a run. */
  series: text("series"),
  /** Carousel, hook, case study… mirrored onto the posts it spawns. */
  postType: text("post_type"),
  tone: text("tone"),
  needsMedia: boolean("needs_media").notNull().default(false),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  status: text("status").$type<IdeaStatus>().notNull().default("backlog"),
  /** What you are aiming at per post. What you reached comes from metrics. */
  targetImpressions: integer("target_impressions"),
  notes: text("notes"),
  /** Filled in after the fact — what this idea taught you. */
  keyLearning: text("key_learning"),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("content_ideas_owner_idx").on(t.ownerId, t.sequence)]);

/**
 * One brand's version of an idea, made when the brand adapts it: its own
 * framing of the three beats, type, tone, hashtags and target, plus an angle
 * and notes only it has. Fields it has not changed follow the idea, the same
 * way master posts work (see `src/lib/ideas.ts`). No row = the brand tells
 * the idea exactly as written.
 */
export const ideaVersions = pgTable("idea_brand_versions", {
  id: id(),
  ideaId: text("idea_id").notNull().references(() => contentIdeas.id, { onDelete: "cascade" }),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  masterSnapshot: jsonb("master_snapshot").$type<Record<string, string>>().notNull().default({}),

  title: text("title").notNull().default(""),
  problem: text("problem").notNull(),
  action: text("action"),
  outcome: text("outcome"),
  postType: text("post_type"),
  tone: text("tone"),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  targetImpressions: integer("target_impressions"),

  /** How this brand tells it — the angle a writer or Claude should take. Never inherited. */
  angle: text("angle"),
  notes: text("notes"),
  /** This brand sits this idea out: fan-out leaves its lane empty. */
  skipped: boolean("skipped").notNull().default(false),

  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("idea_brand_versions_idx").on(t.ideaId, t.brandId)]);

/* -------------------------------------------------------------------- posts */

export const POST_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "failed",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * The master copy of a piece of content, above the brands.
 *
 * Written once, then carried into each brand as an ordinary post that stays
 * linked: every field the brand has not changed follows the master, and a
 * change to the master reaches those copies on save. Where a brand has made a
 * field its own, the change is offered rather than forced. The master never
 * publishes itself — its brand copies do.
 *
 * Belongs to its author and is visible to anyone on a brand that carries a
 * copy, so a team works from one master rather than four.
 */
export const masterPosts = pgTable("master_posts", {
  id: id(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  campaign: text("campaign"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  /** Suggested publish time; each copy may move it. */
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  /** Media ids, in order. Can come from any brand's library the author sees. */
  mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
  /** Platforms a new copy is pointed at, matched to that brand's channels. */
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  /** How brands should adapt this piece. Shown beside every copy. */
  guidelines: text("guidelines"),
  /** Internal working notes. Never published. */
  notes: text("notes"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("master_posts_owner_idx").on(t.ownerId)]);

/** The master copy of the fields a brand copy inherits. See `src/lib/masters.ts`. */
export type MasterSnapshot = {
  title?: string; body?: string; campaign?: string; tags?: string; scheduledAt?: string; media?: string;
};

export const masterPostComments = pgTable("master_post_comments", {
  id: id(),
  masterPostId: text("master_post_id").notNull().references(() => masterPosts.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: now(),
}, (t) => [index("master_post_comments_idx").on(t.masterPostId)]);

/* ----------------------------------------------------------- post templates */

/**
 * A reusable shape for a post: a body with [placeholders] to fill, a title
 * pattern, the platforms it suits, hashtags and a first comment.
 *
 * Same two layers as campaigns: no brand = a master template; a brand row
 * with `masterId` is that brand's linked copy (see `src/lib/templates.ts`);
 * a brand row without one is a template only that brand uses.
 */
export const postTemplates = pgTable("post_templates", {
  id: id(),
  brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  masterId: text("master_id").references((): AnyPgColumn => postTemplates.id, { onDelete: "set null" }),
  masterSnapshot: jsonb("master_snapshot").$type<Record<string, string>>().notNull().default({}),

  name: text("name").notNull(),
  /** When to reach for it. */
  description: text("description"),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  /** Carousel, hook, case study… copied onto posts made from it. */
  postType: text("post_type"),
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  firstComment: text("first_comment"),
  /** This row's own notes — never inherited. */
  notes: text("notes"),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("post_templates_brand_idx").on(t.brandId),
  index("post_templates_master_idx").on(t.masterId),
  index("post_templates_owner_idx").on(t.ownerId),
]);

/* ---------------------------------------------------------------- campaigns */

export const CAMPAIGN_STATUSES = ["planning", "active", "paused", "done"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * A campaign brief: what it is for, what it says, where it sends people, when
 * it runs and what it should reach.
 *
 * One table for both layers. A row with no brand is a master campaign; a
 * brand row with `masterId` is that brand's linked copy, following the master
 * field by field the same way master posts do (see `src/lib/campaigns.ts`); a
 * brand row without one is a campaign only that brand runs.
 *
 * Posts join a campaign by name within their brand — the same free-text
 * `campaign` they always carried, so UTM tagging is unchanged.
 */
export const campaigns = pgTable("campaigns", {
  id: id(),
  /** null = a master campaign, above the brands. */
  brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  masterId: text("master_id").references((): AnyPgColumn => campaigns.id, { onDelete: "set null" }),
  /** The master's values as of the last sync. See MasterSnapshot on posts. */
  masterSnapshot: jsonb("master_snapshot").$type<Record<string, string>>().notNull().default({}),

  name: text("name").notNull(),
  objective: text("objective"),
  /** The one thing every post in the campaign should land. */
  keyMessage: text("key_message"),
  audience: text("audience"),
  cta: text("cta"),
  landingUrl: text("landing_url"),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  startDate: date("start_date"),
  endDate: date("end_date"),
  targetImpressions: integer("target_impressions"),
  targetClicks: integer("target_clicks"),
  targetLeads: integer("target_leads"),

  /** Master only: how brands should run their version. */
  guidelines: text("guidelines"),
  /** This row's own working notes — never inherited. */
  notes: text("notes"),
  status: text("status").$type<CampaignStatus>().notNull().default("planning"),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("campaigns_brand_idx").on(t.brandId),
  index("campaigns_master_idx").on(t.masterId),
  index("campaigns_owner_idx").on(t.ownerId),
]);

export const campaignComments = pgTable("campaign_comments", {
  id: id(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: now(),
}, (t) => [index("campaign_comments_idx").on(t.campaignId)]);

/** One piece of content. Fans out to one row in post_targets per channel. */
export const posts = pgTable("posts", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  /** Base copy. Each target may override it. */
  body: text("body").notNull().default(""),
  status: text("status").$type<PostStatus>().notNull().default("draft"),
  /** Absolute instant to publish. Rendered in the brand's timezone. */
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  campaign: text("campaign"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),

  /* ------------------------------------------------- link back to the plan */
  /** The idea this post tells in this brand's voice. */
  ideaId: text("idea_id").references(() => contentIdeas.id, { onDelete: "set null" }),

  /* ------------------------------------------------- link to the master */
  /** The master this post is this brand's copy of. null = a standalone post. */
  masterPostId: text("master_post_id").references(() => masterPosts.id, { onDelete: "set null" }),
  /**
   * The master's values as of the last sync. A field that still matches it is
   * inherited; one that differs has been customised for this brand.
   */
  masterSnapshot: jsonb("master_snapshot").$type<MasterSnapshot>().notNull().default({}),
  postType: text("post_type"),
  tone: text("tone"),
  /** The number this post was aiming at, copied from the idea but editable. */
  targetImpressions: integer("target_impressions"),
  /** When the author got back to the comments — the sheet's reply time. */
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  keyLearning: text("key_learning"),
  /** Internal working notes. Never published. */
  notes: text("notes"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("posts_brand_idx").on(t.brandId),
  index("posts_scheduled_idx").on(t.scheduledAt),
  index("posts_status_idx").on(t.status),
  index("posts_idea_idx").on(t.ideaId),
  index("posts_master_idx").on(t.masterPostId),
]);

export const TARGET_STATUSES = [
  "pending",
  "scheduled",
  "publishing",
  "awaiting_manual",
  "published",
  "failed",
  "skipped",
] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

/** The post as it will appear on one specific channel. */
export const postTargets = pgTable("post_targets", {
  id: id(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  /** null = use the post's base body. */
  bodyOverride: text("body_override"),
  firstComment: text("first_comment"),
  /** Platform-specific fields: subreddit, board, YT title/privacy, IG reel vs feed… */
  options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<TargetStatus>().notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  externalPostId: text("external_post_id"),
  externalUrl: text("external_url"),
  lastError: text("last_error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: now(),
}, (t) => [
  uniqueIndex("post_targets_post_channel_idx").on(t.postId, t.channelId),
  index("post_targets_status_idx").on(t.status, t.scheduledAt),
]);

/** Media attached to a post, or to one target when it needs different assets. */
export const attachments = pgTable("attachments", {
  id: id(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  targetId: text("target_id").references(() => postTargets.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
}, (t) => [index("attachments_post_idx").on(t.postId)]);

/* --------------------------------------------------------------- engagement */

export {
  INTERACTION_KINDS, INTERACTION_DIRECTIONS, INTERACTION_STATUSES,
  INTERACTION_PRIORITIES, INTERACTION_SENTIMENTS, OPEN_INTERACTION_STATUSES,
} from "./engagement";
import type {
  InteractionKind, InteractionDirection, InteractionStatus,
  InteractionPriority, InteractionSentiment,
} from "./engagement";
export type { InteractionKind, InteractionDirection, InteractionStatus, InteractionPriority, InteractionSentiment };

/**
 * One unit of engagement work: a comment to answer, a DM to reply to, a
 * recommendation to ask for, someone else's thread to show up in.
 *
 * Publishing is only half the job. This table is the other half — the part
 * that actually compounds reach — and it works the same way the publish queue
 * does: whatever a platform's API will hand over gets pulled in, and the rest
 * is logged by a person and worked from one list instead of nine apps.
 */
export const interactions = pgTable("interactions", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  /** Where it happened. Null for work that has no account yet (cold outreach). */
  channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
  /** The post it landed on, when it came from something we published. */
  postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
  targetId: text("target_id").references(() => postTargets.id, { onDelete: "set null" }),

  kind: text("kind").$type<InteractionKind>().notNull().default("comment"),
  direction: text("direction").$type<InteractionDirection>().notNull().default("inbound"),
  status: text("status").$type<InteractionStatus>().notNull().default("new"),
  priority: text("priority").$type<InteractionPriority>().notNull().default("normal"),
  sentiment: text("sentiment").$type<InteractionSentiment>(),

  /* --------------------------------------------------------- the other side */
  authorName: text("author_name"),
  authorHandle: text("author_handle"),
  authorUrl: text("author_url"),
  /** Rough audience size, when the platform shows it. Drives triage order. */
  authorReach: integer("author_reach"),

  /** What they said, or what we mean to say for outbound work. */
  body: text("body").notNull().default(""),
  externalId: text("external_id"),
  externalUrl: text("external_url"),

  /* ------------------------------------------------------------- the clock */
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  /** receivedAt + the brand's SLA. Past this, the row is late. */
  dueAt: timestamp("due_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),

  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  /** Written here, then posted on the platform by hand or by the adapter. */
  replyBody: text("reply_body"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  replyUrl: text("reply_url"),

  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("interactions_brand_status_idx").on(t.brandId, t.status, t.dueAt),
  index("interactions_post_idx").on(t.postId),
  // Re-importing the same comment from an API must not create a second row.
  uniqueIndex("interactions_external_idx").on(t.channelId, t.externalId),
]);

/* ------------------------------------------------------- saved destinations */

/**
 * A named place links send people — a landing page, a signup, a booking link
 * — with the UTM campaign that goes with it. Tracked links are issued from
 * one and keep following it: fix the URL here and every link already posted
 * lands in the right place.
 *
 * Same two layers as templates: no brand = a master destination every brand
 * can issue from; a brand row with `masterId` is that brand's linked copy
 * (its own URL or campaign, say); a brand row without one is its own.
 */
export const linkDestinations = pgTable("link_destinations", {
  id: id(),
  brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  masterId: text("master_id").references((): AnyPgColumn => linkDestinations.id, { onDelete: "set null" }),
  masterSnapshot: jsonb("master_snapshot").$type<Record<string, string>>().notNull().default({}),

  name: text("name").notNull(),
  url: text("url").notNull(),
  /** Overrides the post's campaign as utm_campaign when set. */
  utmCampaign: text("utm_campaign"),
  /** Overrides the channel handle as utm_content when set. */
  utmContent: text("utm_content"),
  notes: text("notes"),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("link_destinations_brand_idx").on(t.brandId),
  index("link_destinations_master_idx").on(t.masterId),
]);

/* ------------------------------------------------------------ tracked links */

/**
 * A short link that stands in for a real destination, issued per channel.
 *
 * Impressions tell you a post was seen. Only this tells you it sent anyone
 * anywhere — and because a link carries its post, channel and idea, traffic
 * can be read back all the way up the plan: which idea, in which brand's
 * voice, on which platform, actually moved people.
 *
 * UTMs are built at redirect time rather than baked into the stored URL, so
 * fixing a campaign name never means reissuing links that are already posted.
 */
export const links = pgTable("links", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  /** The bit after /l/. Short, unguessable, never reused. */
  code: text("code").notNull(),
  /** Where the visitor actually ends up, before UTMs are appended. */
  destination: text("destination").notNull(),
  /** What this link is for, in your words. */
  label: text("label").notNull().default(""),

  /* ------------------------------------------------ what it is attached to */
  postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
  /** The channel this copy went out on — how traffic splits by platform. */
  channelId: text("channel_id").references(() => channels.id, { onDelete: "set null" }),
  /** The exact post target, when the link was issued against a saved post. */
  targetId: text("target_id").references(() => postTargets.id, { onDelete: "set null" }),
  ideaId: text("idea_id").references(() => contentIdeas.id, { onDelete: "set null" }),
  /** The saved destination this link was issued from, and keeps following. */
  destinationId: text("destination_id").references(() => linkDestinations.id, { onDelete: "set null" }),

  /* ------------------------------------------------------------------ utm */
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium").notNull().default("social"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),

  /** Kept alongside the click rows so listing a hundred links stays one query. */
  clickCount: integer("click_count").notNull().default(0),
  uniqueCount: integer("unique_count").notNull().default(0),
  lastClickAt: timestamp("last_click_at", { withTimezone: true }),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
}, (t) => [
  uniqueIndex("links_code_idx").on(t.code),
  index("links_brand_idx").on(t.brandId),
  index("links_post_idx").on(t.postId),
  index("links_idea_idx").on(t.ideaId),
]);

/**
 * One row per redirect served.
 *
 * No IP address is stored. `visitorHash` is a keyed digest of the IP, the user
 * agent and the date, which is enough to tell one person's ten clicks from ten
 * people's and useless for anything else — and it stops being linkable to
 * anyone at midnight.
 */
export const linkClicks = pgTable("link_clicks", {
  id: id(),
  linkId: text("link_id").notNull().references(() => links.id, { onDelete: "cascade" }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  referrer: text("referrer"),
  /** Two-letter country, when the host's edge supplies one. */
  country: text("country"),
  /** "mobile" | "desktop" | "bot" — coarse on purpose. */
  device: text("device"),
  visitorHash: text("visitor_hash"),
  /** Obvious crawlers still get their redirect; they just do not count. */
  isBot: boolean("is_bot").notNull().default(false),
}, (t) => [
  index("link_clicks_link_idx").on(t.linkId, t.clickedAt),
  index("link_clicks_visitor_idx").on(t.linkId, t.visitorHash),
]);

/* ---------------------------------------------------- recurring activities */

import type {
  ActivityCategory, Frequency, Performer, ProofKind, LeadImpact, CheckStatus, ReviewStatus, ActorKind,
} from "../activities/meta";

/**
 * The master list of recurring social media work: one row per activity, shared
 * by every brand. Seeded from `src/lib/activities/library.ts` by `code`, then
 * editable here, so a change to the base template reaches every brand at once.
 */
export const activityTemplates = pgTable("activity_templates", {
  id: id(),
  /** Permanent, human-readable id — what agents and the API address. */
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").$type<ActivityCategory>().notNull(),
  frequency: text("frequency").$type<Frequency>().notNull(),
  /** Empty = every platform the brand is on. Otherwise extra work only where these exist. */
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  target: integer("target").notNull().default(1),
  unit: text("unit").notNull().default("time"),
  proof: text("proof").$type<ProofKind>().notNull().default("note"),
  performer: text("performer").$type<Performer>().notNull().default("human"),
  leadImpact: text("lead_impact").$type<LeadImpact>().notNull().default("medium"),
  estMinutes: integer("est_minutes").notNull().default(15),
  sortOrder: integer("sort_order").notNull().default(0),
  /** False for rows that came from the built-in library. */
  isCustom: boolean("is_custom").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("activity_templates_code_idx").on(t.code)]);

/**
 * Where one brand's action plan departs from the master: an activity switched
 * off (or a platform-specific one switched on without the channel), or a
 * different target. No row = the master applies as-is.
 */
export const brandActivitySettings = pgTable("brand_activity_settings", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull().references(() => activityTemplates.id, { onDelete: "cascade" }),
  /** null = follow the default (on, or on where the brand has the platform). */
  enabled: boolean("enabled"),
  target: integer("target"),
  /**
   * The goal whose plan set this row. Goal-set rows are rewritten whenever a
   * plan changes; a person editing the row takes it back (goalId → null).
   */
  goalId: text("goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("brand_activity_settings_idx").on(t.brandId, t.templateId)]);

/**
 * The tick in the box: one activity, for one brand, in one period — who did
 * it, the proof, and who checked it. No row means not done yet; once the
 * period is over, that reads as missed.
 */
export const activityChecks = pgTable("activity_checks", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull().references(() => activityTemplates.id, { onDelete: "cascade" }),
  /** See `periodFor` — "2026-09-22", "2026-W39", "2026-Q3"… */
  periodKey: text("period_key").notNull(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),

  status: text("status").$type<CheckStatus>().notNull().default("done"),
  /** How many were actually done, against the activity's target. */
  count: integer("count"),
  proofUrl: text("proof_url"),
  notes: text("notes"),

  /* Who did it: a signed-in person, or a named AI agent. */
  doneByKind: text("done_by_kind").$type<ActorKind>().notNull().default("human"),
  doneByName: text("done_by_name"),
  doneByUserId: text("done_by_user_id").references(() => users.id, { onDelete: "set null" }),
  doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),

  /* The second pair of eyes — also a person or an agent. */
  reviewStatus: text("review_status").$type<ReviewStatus>(),
  reviewNote: text("review_note"),
  reviewerKind: text("reviewer_kind").$type<ActorKind>(),
  reviewerName: text("reviewer_name"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

  source: text("source").$type<"app" | "api" | "auto">().notNull().default("app"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("activity_checks_unique_idx").on(t.brandId, t.templateId, t.periodKey),
  index("activity_checks_period_idx").on(t.brandId, t.periodStart),
]);

/* ---------------------------------------------------------------- playbook */

import type {
  RuleKind, EnforceLevel, RuleLimits, ChecklistItem, AdjustStatus, AdjustSource,
} from "../playbook/meta";

/**
 * The master playbook: one rule per format (post, reel, story…) or kind of
 * work (replying, DMs…), with the limits the app checks and the points people
 * and agents confirm. Seeded from `src/lib/playbook/library.ts` by `code`,
 * then editable here; every brand works to it unless it has adjusted a limit.
 */
export const playbookRules = pgTable("playbook_rules", {
  id: id(),
  /** Permanent: posts carry it as their format and agents address it. */
  code: text("code").notNull(),
  kind: text("kind").$type<RuleKind>().notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  activityCodes: jsonb("activity_codes").$type<string[]>().notNull().default([]),
  enforce: text("enforce").$type<EnforceLevel>().notNull().default("block"),
  limits: jsonb("limits").$type<RuleLimits>().notNull().default({}),
  checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  isCustom: boolean("is_custom").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("playbook_rules_code_idx").on(t.code)]);

/**
 * Where one brand departs from a master rule. Only the limits it has changed
 * are stored, so everything else keeps following the master. No row = the
 * master as-is.
 */
export const brandPlaybookRules = pgTable("brand_playbook_rules", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull().references(() => playbookRules.id, { onDelete: "cascade" }),
  /** null = follow the master (on). */
  enabled: boolean("enabled"),
  enforce: text("enforce").$type<EnforceLevel>(),
  limits: jsonb("limits").$type<RuleLimits>().notNull().default({}),
  /** Points only this brand checks, after the master's. */
  extraChecklist: jsonb("extra_checklist").$type<ChecklistItem[]>().notNull().default([]),
  /** Master points this brand leaves out, by id. */
  hiddenChecklist: jsonb("hidden_checklist").$type<string[]>().notNull().default([]),
  /** This brand's own instructions, shown after the master's. */
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("brand_playbook_rules_idx").on(t.brandId, t.ruleId)]);

/**
 * Every change to a rule, and every change someone suggested: the field, the
 * value before and after (JSON text), why, the numbers behind it, and who
 * made or decided it. The daily review works through the "proposed" rows.
 * No brand = a change to the master.
 */
export const playbookAdjustments = pgTable("playbook_adjustments", {
  id: id(),
  ruleId: text("rule_id").notNull().references(() => playbookRules.id, { onDelete: "cascade" }),
  brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  before: text("before"),
  after: text("after"),
  reason: text("reason").notNull().default(""),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  status: text("status").$type<AdjustStatus>().notNull(),
  source: text("source").$type<AdjustSource>().notNull(),
  actorKind: text("actor_kind").$type<ActorKind>().notNull(),
  actorName: text("actor_name"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  decidedKind: text("decided_kind").$type<ActorKind>(),
  decidedName: text("decided_name"),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: now(),
}, (t) => [
  index("playbook_adjustments_brand_idx").on(t.brandId, t.status, t.createdAt),
  index("playbook_adjustments_rule_idx").on(t.ruleId, t.createdAt),
]);

/* ------------------------------------------------------------------- goals */

import type { DriverSpec, GoalDriver, GoalMetric, Curve, GoalStatus, GoalPlan, RevisionKind, RevisionStatus } from "../goals/meta";

/**
 * The master goal templates: one per metric worth steering by (followers,
 * site visitors, comments…), each with the activities that move it and a
 * benchmark yield for each. Seeded from `src/lib/goals/library.ts` by code.
 */
export const goalTemplates = pgTable("goal_templates", {
  id: id(),
  code: text("code").notNull(),
  metric: text("metric").$type<GoalMetric>().notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  drivers: jsonb("drivers").$type<DriverSpec[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  isCustom: boolean("is_custom").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("goal_templates_code_idx").on(t.code)]);

/**
 * One brand's goal: a metric, where it started, where it has to be and by
 * when. `drivers` starts as the template's and then carries this brand's
 * learned yields; `plan` is the plan in force — the weekly volumes the
 * activity checklists are following.
 */
export const goals = pgTable("goals", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => goalTemplates.id, { onDelete: "set null" }),
  metric: text("metric").$type<GoalMetric>().notNull(),
  name: text("name").notNull(),
  /** null = every channel the brand has; otherwise one platform's channels. */
  platform: text("platform"),
  curve: text("curve").$type<Curve>().notNull().default("compound"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  /** A level for stock metrics, a monthly rate for flows. */
  startValue: doublePrecision("start_value").notNull(),
  targetValue: doublePrecision("target_value").notNull(),
  deadline: date("deadline", { mode: "string" }).notNull(),
  status: text("status").$type<GoalStatus>().notNull().default("active"),
  drivers: jsonb("drivers").$type<GoalDriver[]>().notNull().default([]),
  /** Weekly organic change with no work done, learned alongside the yields. */
  baseline: doublePrecision("baseline").notNull().default(0),
  plan: jsonb("plan").$type<GoalPlan | null>(),
  /** New plans that move any weekly volume by more than this wait for a person. */
  approvalThreshold: integer("approval_threshold").notNull().default(30),
  lastRecalibratedAt: timestamp("last_recalibrated_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("goals_brand_idx").on(t.brandId, t.status)]);

/**
 * Every plan a goal has had, and why it changed: the numbers before and
 * after, the reasons in words, and who approved it. "proposed" rows are
 * waiting for someone because the change was large.
 */
export const goalRevisions = pgTable("goal_revisions", {
  id: id(),
  goalId: text("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  kind: text("kind").$type<RevisionKind>().notNull(),
  status: text("status").$type<RevisionStatus>().notNull(),
  summary: text("summary").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  before: jsonb("before").$type<{ plan: GoalPlan | null; yields: Record<string, number>; baseline: number } | null>(),
  after: jsonb("after").$type<{ plan: GoalPlan; yields: Record<string, number>; baseline: number }>().notNull(),
  /** Where the metric stood when the revision was made, and where the plan wanted it. */
  actualValue: doublePrecision("actual_value"),
  plannedValue: doublePrecision("planned_value"),
  /** null = the weekly job. */
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [index("goal_revisions_goal_idx").on(t.goalId, t.createdAt)]);

/**
 * A reading of an account-level number on a day: a channel's follower count,
 * or visits and messages the app cannot see for itself. Logged by hand or
 * pulled from a platform API; one per brand, metric, channel and day.
 * `scopeKey` is the channel id, or "brand" for a whole-brand reading.
 */
export const metricSnapshots = pgTable("metric_snapshots", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  scopeKey: text("scope_key").notNull(),
  metric: text("metric").$type<GoalMetric>().notNull(),
  date: date("date", { mode: "string" }).notNull(),
  value: doublePrecision("value").notNull(),
  source: text("source").$type<"manual" | "api">().notNull().default("manual"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("metric_snapshots_unique_idx").on(t.brandId, t.metric, t.scopeKey, t.date),
  index("metric_snapshots_brand_idx").on(t.brandId, t.metric, t.date),
]);

/**
 * A bearer token that lets an AI agent (Claude, ChatGPT, a script) read the
 * checklists and record or review work. It acts as the person who created it,
 * so it reaches exactly the brands they can. Only a hash is stored.
 */
export const agentTokens = pgTable("agent_tokens", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Recorded as "done by" on everything the token does, e.g. "Claude". */
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  /** The first characters, so a person can tell tokens apart without the secret. */
  prefix: text("prefix").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [uniqueIndex("agent_tokens_hash_idx").on(t.tokenHash), index("agent_tokens_user_idx").on(t.userId)]);

/* ------------------------------------------------------- review & activity */

export const comments = pgTable("comments", {
  id: id(),
  postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  kind: text("kind").$type<"comment" | "approved" | "changes_requested">().notNull().default("comment"),
  createdAt: now(),
}, (t) => [index("comments_post_idx").on(t.postId)]);

export const activity = pgTable("activity", {
  id: id(),
  brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: now(),
}, (t) => [index("activity_brand_idx").on(t.brandId, t.createdAt)]);

/* ---------------------------------------------------------------- analytics */

export const metrics = pgTable("metrics", {
  id: id(),
  targetId: text("target_id").notNull().references(() => postTargets.id, { onDelete: "cascade" }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  impressions: integer("impressions").notNull().default(0),
  reach: integer("reach").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  videoViews: integer("video_views").notNull().default(0),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("metrics_target_idx").on(t.targetId, t.fetchedAt)]);

/* ------------------------------------------------------------ invitations */

export const invites = pgTable("invites", {
  token: text("token").primaryKey().$defaultFn(() => nanoid(32)),
  email: text("email").notNull(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  role: text("role").$type<Role>().notNull().default("editor"),
  invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: now(),
});

/* -------------------------------------------------------------- relations */

export const brandsRelations = relations(brands, ({ many }) => ({
  channels: many(channels),
  posts: many(posts),
  memberships: many(memberships),
  media: many(media),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  brand: one(brands, { fields: [memberships.brandId], references: [brands.id] }),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  brand: one(brands, { fields: [channels.brandId], references: [brands.id] }),
  targets: many(postTargets),
}));

export const contentIdeasRelations = relations(contentIdeas, ({ one, many }) => ({
  owner: one(users, { fields: [contentIdeas.ownerId], references: [users.id] }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  brand: one(brands, { fields: [posts.brandId], references: [brands.id] }),
  idea: one(contentIdeas, { fields: [posts.ideaId], references: [contentIdeas.id] }),
  master: one(masterPosts, { fields: [posts.masterPostId], references: [masterPosts.id] }),
  author: one(users, { fields: [posts.createdBy], references: [users.id] }),
  targets: many(postTargets),
  attachments: many(attachments),
  comments: many(comments),
}));

export const masterPostsRelations = relations(masterPosts, ({ one, many }) => ({
  owner: one(users, { fields: [masterPosts.ownerId], references: [users.id] }),
  copies: many(posts),
  comments: many(masterPostComments),
}));

export const masterPostCommentsRelations = relations(masterPostComments, ({ one }) => ({
  master: one(masterPosts, { fields: [masterPostComments.masterPostId], references: [masterPosts.id] }),
  user: one(users, { fields: [masterPostComments.userId], references: [users.id] }),
}));

export const postTargetsRelations = relations(postTargets, ({ one, many }) => ({
  post: one(posts, { fields: [postTargets.postId], references: [posts.id] }),
  channel: one(channels, { fields: [postTargets.channelId], references: [channels.id] }),
  metrics: many(metrics),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  post: one(posts, { fields: [attachments.postId], references: [posts.id] }),
  media: one(media, { fields: [attachments.mediaId], references: [media.id] }),
  target: one(postTargets, { fields: [attachments.targetId], references: [postTargets.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  user: one(users, { fields: [comments.userId], references: [users.id] }),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  brand: one(brands, { fields: [media.brandId], references: [brands.id] }),
}));

export const linksRelations = relations(links, ({ one, many }) => ({
  brand: one(brands, { fields: [links.brandId], references: [brands.id] }),
  channel: one(channels, { fields: [links.channelId], references: [channels.id] }),
  post: one(posts, { fields: [links.postId], references: [posts.id] }),
  target: one(postTargets, { fields: [links.targetId], references: [postTargets.id] }),
  idea: one(contentIdeas, { fields: [links.ideaId], references: [contentIdeas.id] }),
  clicks: many(linkClicks),
}));

export const linkClicksRelations = relations(linkClicks, ({ one }) => ({
  link: one(links, { fields: [linkClicks.linkId], references: [links.id] }),
}));

export const interactionsRelations = relations(interactions, ({ one }) => ({
  brand: one(brands, { fields: [interactions.brandId], references: [brands.id] }),
  channel: one(channels, { fields: [interactions.channelId], references: [channels.id] }),
  post: one(posts, { fields: [interactions.postId], references: [posts.id] }),
  assignee: one(users, { fields: [interactions.assigneeId], references: [users.id] }),
}));

export const metricsRelations = relations(metrics, ({ one }) => ({
  target: one(postTargets, { fields: [metrics.targetId], references: [postTargets.id] }),
}));
