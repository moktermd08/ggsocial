/**
 * Playbook types and labels, importable from client components without
 * pulling in drizzle.
 *
 * The playbook is the master set of rules for every kind of thing a brand puts
 * out or does: a feed post, a reel, a story, a reply to a comment. Each rule
 * has measurable limits the app checks by itself (title length, hashtag count,
 * media size, posting time) and a checklist of the points only a person or an
 * agent can judge. Every brand follows the master and may adjust any limit;
 * every adjustment, by a person, an agent or the daily tuning job, is logged.
 */

export const RULE_KINDS = ["format", "activity"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const RULE_KIND_META: Record<RuleKind, { label: string; hint: string }> = {
  format: { label: "Content formats", hint: "What gets published: posts, reels, stories, videos, articles" },
  activity: { label: "Engagement & outreach", hint: "How recurring work is done: replies, DMs, comments, reviews" },
};

/** What a failed limit does. Posting-time advice is always a warning: news and launches do not wait for a window. */
export const ENFORCE_LEVELS = ["block", "warn"] as const;
export type EnforceLevel = (typeof ENFORCE_LEVELS)[number];
export const ENFORCE_META: Record<EnforceLevel, { label: string; hint: string }> = {
  block: { label: "Must", hint: "A broken limit stops scheduling and approval" },
  warn: { label: "Should", hint: "A broken limit is flagged, but does not stop anything" },
};

export const MEDIA_KINDS = ["any", "image", "video", "none"] as const;
export type RuleMediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Everything the app can measure on its own. Every key is optional: a rule
 * sets the ones that matter for it. Timing is kept as text ("07:00-09:00,
 * 18:00-20:00", "mon-fri") so a person can read and type it as-is.
 */
export type RuleLimits = {
  titleRequired?: boolean;
  titleMaxWords?: number;
  hashtagsMin?: number;
  hashtagsMax?: number;
  bodyMinChars?: number;
  bodyMaxChars?: number;
  mediaKind?: RuleMediaKind;
  mediaMin?: number;
  mediaMax?: number;
  /** One or more ratios, comma-separated: "9:16" or "4:5, 1:1". */
  aspectRatio?: string;
  minWidth?: number;
  minHeight?: number;
  videoMinSeconds?: number;
  videoMaxSeconds?: number;
  /** Posting windows in the brand's own timezone. */
  windows?: string;
  /** Days worth posting on: "mon-fri", "tue,thu,sat". */
  days?: string;
  /** How many a week the brand aims to put out. Guidance for planning, not checked per post. */
  perWeek?: number;
};
export type LimitKey = keyof RuleLimits;
export type LimitValue = RuleLimits[LimitKey];

type LimitGroup = "copy" | "media" | "timing";
export const LIMIT_GROUPS: Record<LimitGroup, string> = { copy: "Copy", media: "Media", timing: "Timing" };

export const LIMIT_FIELDS: {
  key: LimitKey; label: string; group: LimitGroup;
  type: "number" | "boolean" | "text" | "select";
  unit?: string; placeholder?: string; choices?: readonly string[]; hint?: string;
}[] = [
  { key: "titleRequired", label: "Title required", group: "copy", type: "boolean" },
  { key: "titleMaxWords", label: "Title, max words", group: "copy", type: "number", unit: "words" },
  { key: "hashtagsMin", label: "Hashtags, at least", group: "copy", type: "number" },
  { key: "hashtagsMax", label: "Hashtags, at most", group: "copy", type: "number" },
  { key: "bodyMinChars", label: "Copy, at least", group: "copy", type: "number", unit: "characters" },
  { key: "bodyMaxChars", label: "Copy, at most", group: "copy", type: "number", unit: "characters" },
  { key: "mediaKind", label: "Media type", group: "media", type: "select", choices: MEDIA_KINDS },
  { key: "mediaMin", label: "Files, at least", group: "media", type: "number" },
  { key: "mediaMax", label: "Files, at most", group: "media", type: "number" },
  { key: "aspectRatio", label: "Aspect ratio", group: "media", type: "text", placeholder: "9:16 or 4:5, 1:1" },
  { key: "minWidth", label: "Min width", group: "media", type: "number", unit: "px" },
  { key: "minHeight", label: "Min height", group: "media", type: "number", unit: "px" },
  { key: "videoMinSeconds", label: "Video, at least", group: "media", type: "number", unit: "seconds" },
  { key: "videoMaxSeconds", label: "Video, at most", group: "media", type: "number", unit: "seconds" },
  { key: "windows", label: "Posting windows", group: "timing", type: "text", placeholder: "08:00-10:00, 18:00-20:00", hint: "In the brand's timezone" },
  { key: "days", label: "Posting days", group: "timing", type: "text", placeholder: "mon-fri" },
  { key: "perWeek", label: "Per week", group: "timing", type: "number", hint: "Planning target" },
];

export const LIMIT_KEYS = LIMIT_FIELDS.map((f) => f.key);
export const LIMIT_LABELS = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, f.label])) as Record<LimitKey, string>;

/** Who a checklist point is for. Agents skip "human" points and people may skip "agent" ones. */
export const CHECK_AUDIENCES = ["all", "human", "agent"] as const;
export type CheckAudience = (typeof CHECK_AUDIENCES)[number];
export const CHECK_AUDIENCE_META: Record<CheckAudience, string> = {
  all: "Everyone",
  human: "People only",
  agent: "Agents only",
};

/** A point that has to be judged rather than measured, confirmed before approval. */
export type ChecklistItem = { id: string; text: string; for: CheckAudience };

/* ------------------------------------------------------------ adjustments */

/**
 * The fields an adjustment can change: any limit, whether the rule applies,
 * how strictly it is enforced, and the checklist (add a point, or replace the
 * lot when a person edits it by hand).
 */
export type AdjustField = LimitKey | "enabled" | "enforce" | "checklist.add" | "checklist" | "instructions";

export const ADJUST_STATUSES = ["proposed", "applied", "rejected", "superseded"] as const;
export type AdjustStatus = (typeof ADJUST_STATUSES)[number];
export const ADJUST_STATUS_META: Record<AdjustStatus, { label: string; color: string }> = {
  proposed: { label: "Waiting for a decision", color: "#b45309" },
  applied: { label: "Applied", color: "#15803d" },
  rejected: { label: "Rejected", color: "#b91c1c" },
  superseded: { label: "Superseded", color: "#64748b" },
};

/** Where an adjustment came from: a person editing, an agent over the API, or the daily tuning job. */
export const ADJUST_SOURCES = ["manual", "agent", "auto"] as const;
export type AdjustSource = (typeof ADJUST_SOURCES)[number];
export const ADJUST_SOURCE_META: Record<AdjustSource, string> = {
  manual: "Edited by a person",
  agent: "Suggested by an agent",
  auto: "Suggested by daily tuning",
};

export function adjustFieldLabel(field: string) {
  if (field === "enabled") return "Applies to this brand";
  if (field === "enforce") return "Strictness";
  if (field === "checklist.add") return "New checklist point";
  if (field === "checklist") return "Checklist";
  if (field === "instructions") return "Instructions";
  return LIMIT_LABELS[field as LimitKey] ?? field;
}

export function isAdjustField(field: string): field is AdjustField {
  return (LIMIT_KEYS as string[]).includes(field)
    || ["enabled", "enforce", "checklist.add", "checklist", "instructions"].includes(field);
}

/** A short random id for a checklist point, client-safe. */
export function newItemId() {
  return Math.random().toString(36).slice(2, 10);
}
