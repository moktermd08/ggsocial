import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
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
  logoUrl: text("logo_url"),
  /** Named palette entries — primary, accent, ink, and so on. */
  palette: jsonb("palette").$type<BrandColor[]>().notNull().default([]),
  fontHeading: text("font_heading"),
  fontBody: text("font_body"),
  /** Logo dos and don'ts, clear space, which mark to use where. */
  logoUsage: text("logo_usage"),
  imageStyle: text("image_style"),

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
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [index("channels_brand_idx").on(t.brandId)]);

/* -------------------------------------------------------------------- media */

export const media = pgTable("media", {
  id: id(),
  brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
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
  uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: now(),
}, (t) => [index("media_brand_idx").on(t.brandId)]);

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
  author: one(users, { fields: [posts.createdBy], references: [users.id] }),
  targets: many(postTargets),
  attachments: many(attachments),
  comments: many(comments),
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
