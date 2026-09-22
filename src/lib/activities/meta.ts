/** Activity enums and labels, importable from client components without pulling in drizzle. */

/**
 * How often an activity comes round. Every one of these is a fixed calendar
 * window, so "did we do it this week?" always has one answer for everyone.
 */
export const FREQUENCIES = [
  "daily", "every_2_days", "weekly", "monthly", "quarterly", "half_yearly", "yearly",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_META: Record<Frequency, { label: string; short: string; noun: string }> = {
  daily: { label: "Daily", short: "Day", noun: "day" },
  every_2_days: { label: "Every 2 days", short: "2 days", noun: "two-day window" },
  weekly: { label: "Weekly", short: "Week", noun: "week" },
  monthly: { label: "Monthly", short: "Month", noun: "month" },
  quarterly: { label: "Quarterly", short: "Quarter", noun: "quarter" },
  half_yearly: { label: "Six-monthly", short: "Half", noun: "half-year" },
  yearly: { label: "Yearly", short: "Year", noun: "year" },
};

export const ACTIVITY_CATEGORIES = [
  "presence", "content", "engagement", "outreach", "networking", "community", "profile", "reputation", "analytics", "admin",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const CATEGORY_META: Record<ActivityCategory, { label: string; color: string; hint: string }> = {
  presence: { label: "Pages live", color: "#0891b2", hint: "Each channel's page exists and is ours" },
  content: { label: "Content & publishing", color: "#4f46e5", hint: "Posts, video, lives, polls, articles" },
  engagement: { label: "Engagement", color: "#0f766e", hint: "Comments, replies, likes, shares" },
  outreach: { label: "Leads & outreach", color: "#b45309", hint: "DMs, follow-ups, lead capture" },
  networking: { label: "Connections & network", color: "#7c3aed", hint: "Connect, endorse, partners" },
  community: { label: "Groups & communities", color: "#0369a1", hint: "Join, contribute, answer" },
  profile: { label: "Profiles & listings", color: "#be185d", hint: "Bios, details, links, visuals" },
  reputation: { label: "Reviews & reputation", color: "#15803d", hint: "Ask for, reply to and give reviews" },
  analytics: { label: "Measure & improve", color: "#475569", hint: "Reports, learnings, planning" },
  admin: { label: "Access & security", color: "#9f1239", hint: "Logins, owners, tokens, backups" },
};

/** Who can realistically carry the task out. */
export const PERFORMERS = ["human", "either", "ai"] as const;
export type Performer = (typeof PERFORMERS)[number];
export const PERFORMER_META: Record<Performer, { label: string; hint: string }> = {
  human: { label: "Human", hint: "Needs a person's judgement, voice or login" },
  either: { label: "Human or AI", hint: "An AI agent can draft or do it; a person can too" },
  ai: { label: "AI-ready", hint: "An AI agent with access can do it end to end" },
};

export const PROOF_KINDS = ["link", "screenshot", "count", "note"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];
export const PROOF_META: Record<ProofKind, string> = {
  link: "Link to the post, thread or page",
  screenshot: "Screenshot link",
  count: "How many were done",
  note: "Short note of what was done",
};

export const LEAD_IMPACTS = ["high", "medium", "low"] as const;
export type LeadImpact = (typeof LEAD_IMPACTS)[number];

/** What a check can say about one activity, for one brand, in one period. "open" = no row yet. */
export const CHECK_STATUSES = ["done", "partial", "skipped"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type CellStatus = CheckStatus | "open" | "missed";

export const CELL_STATUS_META: Record<CellStatus, { label: string; color: string }> = {
  open: { label: "To do", color: "#8b8b96" },
  done: { label: "Done", color: "#15803d" },
  partial: { label: "Partly", color: "#b45309" },
  skipped: { label: "Skipped", color: "#64748b" },
  missed: { label: "Missed", color: "#b91c1c" },
};

export const REVIEW_STATUSES = ["approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Who did or reviewed the work: a signed-in person, or an AI agent (named). */
export const ACTOR_KINDS = ["human", "ai"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Common agent names offered when someone records AI work by hand. */
export const AGENT_SUGGESTIONS = ["Claude", "ChatGPT", "Gemini", "Copilot", "Perplexity"];

/** "5 comments", but "all comments" rather than "1 all comments". */
export function targetText(target: number, unit: string) {
  return /^all\b/i.test(unit) ? unit : `${target} ${unit}`;
}
