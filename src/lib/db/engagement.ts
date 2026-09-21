/** Engagement enums, importable from client components without pulling in drizzle. */

/**
 * The kinds of engagement work a channel generates.
 *
 * "outbound" kinds are things you go and do — commenting on someone else's
 * post, asking for a recommendation. They matter as much as inbound: on every
 * platform, showing up in other people's threads moves more traffic than
 * anything you post on your own page.
 */
export const INTERACTION_KINDS = [
  "comment", "reply", "mention", "message", "review",
  "recommendation", "endorsement", "lead", "outreach",
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const INTERACTION_KIND_LABELS: Record<InteractionKind, string> = {
  comment: "Comment",
  reply: "Reply to us",
  mention: "Mention",
  message: "Message",
  review: "Review",
  recommendation: "Recommendation",
  endorsement: "Endorsement",
  lead: "Lead",
  outreach: "Outreach",
};

export const INTERACTION_DIRECTIONS = ["inbound", "outbound"] as const;
export type InteractionDirection = (typeof INTERACTION_DIRECTIONS)[number];

export const INTERACTION_STATUSES = ["new", "in_progress", "snoozed", "replied", "done", "ignored"] as const;
export type InteractionStatus = (typeof INTERACTION_STATUSES)[number];

export const INTERACTION_STATUS_META: Record<InteractionStatus, { label: string; color: string }> = {
  new: { label: "New", color: "#4f46e5" },
  in_progress: { label: "Working", color: "#b45309" },
  snoozed: { label: "Snoozed", color: "#8b8b96" },
  replied: { label: "Replied", color: "#0f766e" },
  done: { label: "Done", color: "#15803d" },
  ignored: { label: "Ignored", color: "#8b8b96" },
};

/** Statuses that still need someone — what the queue and the nav badge count. */
export const OPEN_INTERACTION_STATUSES = ["new", "in_progress", "snoozed"] as const;

export const INTERACTION_PRIORITIES = ["low", "normal", "high"] as const;
export type InteractionPriority = (typeof INTERACTION_PRIORITIES)[number];

export const INTERACTION_SENTIMENTS = ["positive", "neutral", "negative", "question"] as const;
export type InteractionSentiment = (typeof INTERACTION_SENTIMENTS)[number];
