/**
 * The formats one piece of content can take, and which platforms carry which.
 * Client-safe: no database. The codes are the playbook's format rule codes, so
 * a version's format picks its playbook rule directly.
 *
 * A post is the idea told once for a brand; its *versions* are that same
 * content made ready in every format the brand's channels can carry, so that
 * whichever suits a channel is already written when it is time to post.
 */

export const CONTENT_FORMATS = [
  "post", "carousel", "thread", "reel", "short", "story", "video", "article", "newsletter",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

/** What a version carries beyond its caption, which decides what the editor and preview show. */
export type FormatShape = "text" | "slides" | "posts" | "video" | "long";

export const FORMAT_META: Record<ContentFormat, {
  label: string; shape: FormatShape; blurb: string; outlineLabel: string | null; needsMedia: "none" | "image" | "video";
}> = {
  post: { label: "Text post", shape: "text", blurb: "One caption, with an image if it helps.", outlineLabel: null, needsMedia: "none" },
  carousel: { label: "Carousel", shape: "slides", blurb: "Swipeable slides: a hook, one point each, a close.", outlineLabel: "Slides", needsMedia: "image" },
  thread: { label: "Thread", shape: "posts", blurb: "A run of short posts, each one worth reading alone.", outlineLabel: "Posts in the thread", needsMedia: "none" },
  reel: { label: "Reel", shape: "video", blurb: "Vertical video up to about 90 seconds.", outlineLabel: "Shot list", needsMedia: "video" },
  short: { label: "Short", shape: "video", blurb: "Vertical video under a minute, hook in the first second.", outlineLabel: "Shot list", needsMedia: "video" },
  story: { label: "Story", shape: "slides", blurb: "Full-screen frames that disappear in a day.", outlineLabel: "Frames", needsMedia: "image" },
  video: { label: "Long video", shape: "video", blurb: "Landscape video with a title, chapters and a script.", outlineLabel: "Chapters", needsMedia: "video" },
  article: { label: "Article", shape: "long", blurb: "A long read with a headline and sections.", outlineLabel: "Sections", needsMedia: "none" },
  newsletter: { label: "Newsletter", shape: "long", blurb: "An email: subject line, preview text, body.", outlineLabel: "Sections", needsMedia: "none" },
};

export function isFormat(v: unknown): v is ContentFormat {
  return typeof v === "string" && (CONTENT_FORMATS as readonly string[]).includes(v);
}

/**
 * Each platform's formats, best-for-reach first. A platform not listed falls
 * back on its category: videos carry video, blogs carry articles, email
 * carries newsletters, and everything else carries a post.
 */
const BY_PLATFORM: Record<string, ContentFormat[]> = {
  instagram: ["reel", "carousel", "post", "story"],
  facebook: ["reel", "post", "video", "story"],
  linkedin: ["carousel", "post", "video", "article"],
  x: ["thread", "post"],
  threads: ["post", "thread"],
  bluesky: ["post", "thread"],
  mastodon: ["post", "thread"],
  tiktok: ["short"],
  youtube: ["short", "video"],
  pinterest: ["post"],
  snapchat: ["story", "short"],
  telegram: ["post"],
  whatsapp: ["post"],
};

const BY_CATEGORY: Record<string, ContentFormat[]> = {
  video: ["video", "short"],
  blog: ["article"],
  email: ["newsletter"],
  community: ["post"],
};

export function formatsForPlatform(platform: string, category?: string | null): ContentFormat[] {
  return BY_PLATFORM[platform] ?? BY_CATEGORY[category ?? ""] ?? ["post"];
}

/**
 * The format this channel should carry, given the versions that exist and are
 * not ruled out: the first of the platform's preferred formats that is
 * available. null when none of its formats has a version.
 */
export function pickFormat(
  platform: string, category: string | null | undefined, available: Iterable<ContentFormat>,
): ContentFormat | null {
  const have = new Set(available);
  return formatsForPlatform(platform, category).find((f) => have.has(f)) ?? null;
}

/** Every format any of these channels can carry, in a stable order, capped to keep a run affordable. */
export function formatsNeeded(channels: { platform: string; category?: string | null }[], cap = 5): ContentFormat[] {
  const rank = new Map<ContentFormat, number>();
  for (const c of channels) {
    // A channel's first choice counts most: it is what will actually go out.
    formatsForPlatform(c.platform, c.category).forEach((f, i) => rank.set(f, (rank.get(f) ?? 0) + (10 - i)));
  }
  const base = CONTENT_FORMATS.filter((f) => rank.has(f));
  base.sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0) || CONTENT_FORMATS.indexOf(a) - CONTENT_FORMATS.indexOf(b));
  return base.slice(0, cap);
}

/* ---------------------------------------------------------------- versions */

export const VERSION_STATUSES = ["outline", "drafted", "ready"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const VERSION_STATUS_META: Record<VersionStatus, { label: string; color: string }> = {
  outline: { label: "Outline", color: "#94a3b8" },
  drafted: { label: "Drafted", color: "#f59e0b" },
  ready: { label: "Ready", color: "#10b981" },
};

export type VersionContent = {
  format: ContentFormat;
  title: string;
  body: string;
  outline: string[];
  script: string;
};

/**
 * What goes out on a channel for this version. Threads are sent as blank-line
 * separated posts (the way the X adapter splits them); everything else goes
 * out as its caption or body, with the platform picking up media separately.
 */
export function versionPublishText(v: Pick<VersionContent, "format" | "body" | "outline">) {
  if (v.format === "thread" && v.outline.length) return v.outline.join("\n\n");
  return v.body;
}

/** Platform option values that make a platform publish the version in its format. */
export function versionOptions(platform: string, format: ContentFormat): Record<string, unknown> {
  if (platform === "instagram") {
    return { format: format === "reel" ? "reel" : format === "story" ? "story" : "feed" };
  }
  if (platform === "x" && format === "thread") return { thread: true };
  return {};
}
