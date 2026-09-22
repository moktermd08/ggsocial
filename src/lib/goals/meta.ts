/** Goal enums, labels and shared shapes, importable from client components without pulling in drizzle. */

/**
 * What a goal can measure. A "stock" is a level you grow and keep (followers);
 * a "flow" is a count per month you want to reach (visitors, comments…).
 */
export const GOAL_METRICS = ["followers", "site_visitors", "comments", "messages", "engagement", "reach", "leads"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export type MetricKind = "stock" | "flow";

/**
 * Where the actual numbers come from. Snapshots are logged by hand or pulled
 * from a platform API; everything else is counted from what the app already
 * records, with manual snapshots added on top for what it cannot see.
 */
export type MetricSource = "snapshot" | "clicks" | "comments" | "messages" | "leads" | "post_engagement" | "post_reach";

export const METRIC_META: Record<GoalMetric, {
  label: string; noun: string; kind: MetricKind; source: MetricSource; color: string; how: string;
}> = {
  followers: {
    label: "Followers", noun: "followers", kind: "stock", source: "snapshot", color: "#4f46e5",
    how: "Follower counts per channel, pulled daily from live channels or logged by hand.",
  },
  site_visitors: {
    label: "Site visitors", noun: "visitors", kind: "flow", source: "clicks", color: "#0f766e",
    how: "Unique people who clicked a tracked link, plus any visits you log by hand.",
  },
  comments: {
    label: "Comments", noun: "comments", kind: "flow", source: "comments", color: "#b45309",
    how: "Comments and replies on our posts in the engagement queue, plus any you log by hand.",
  },
  messages: {
    label: "Messages", noun: "messages", kind: "flow", source: "messages", color: "#7c3aed",
    how: "Inbound DMs and page messages in the engagement queue, plus any you log by hand.",
  },
  engagement: {
    label: "Engagement", noun: "engagements", kind: "flow", source: "post_engagement", color: "#db2777",
    how: "Likes, comments, shares and saves on posts published that month, plus any you log by hand.",
  },
  reach: {
    label: "Reach", noun: "people reached", kind: "flow", source: "post_reach", color: "#0369a1",
    how: "Reach (or impressions where reach is missing) on posts published that month, plus any you log by hand.",
  },
  leads: {
    label: "Leads", noun: "leads", kind: "flow", source: "leads", color: "#15803d",
    how: "Leads logged in the engagement queue, plus any you log by hand.",
  },
};

/** Stock goals aim at a level; flow goals aim at a monthly rate. */
export function targetPhrase(metric: GoalMetric, value: number) {
  const m = METRIC_META[metric];
  return m.kind === "stock" ? `${compact(value)} ${m.noun}` : `${compact(value)} ${m.noun} a month`;
}

export const CURVES = ["compound", "linear"] as const;
export type Curve = (typeof CURVES)[number];
export const CURVE_META: Record<Curve, { label: string; hint: string }> = {
  compound: { label: "Compound", hint: "Grows by the same percentage each week, the way audiences really grow: small gains early, bigger ones later." },
  linear: { label: "Straight line", hint: "The same amount every week. Front-loads the work; good for short goals." },
};

export const GOAL_STATUSES = ["active", "paused", "achieved", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** How far off the plan a goal is running. */
export type Pace = "ahead" | "on_track" | "behind" | "at_risk" | "no_data";
export const PACE_META: Record<Pace, { label: string; color: string }> = {
  ahead: { label: "Ahead", color: "#15803d" },
  on_track: { label: "On track", color: "#0f766e" },
  behind: { label: "Behind", color: "#b45309" },
  at_risk: { label: "At risk", color: "#b91c1c" },
  no_data: { label: "Needs numbers", color: "#64748b" },
};

/**
 * How a driver's yield grows. Content a brand posts reaches more people as the
 * audience grows, so its yield is per 1,000 of the current audience; outbound
 * work (comments, requests, group posts) earns the same whatever the size.
 */
export type DriverScale = "fixed" | "audience";

/**
 * One activity that moves a metric, and by how much. `yield` is the metric
 * gained per unit done — per 1,000 audience for audience-scaled drivers.
 */
export type DriverSpec = {
  /** The activity in the master list this driver sets targets for. */
  activityCode: string;
  label: string;
  /** Plural noun for one unit of the activity: "videos", "comments". */
  unitLabel: string;
  yield: number;
  scale: DriverScale;
  /** Part of the required gain the plan puts on this driver, before learning shifts it. */
  share: number;
  /** A realistic ceiling per week, so the plan never asks for 40 reels a day. */
  maxPerWeek: number;
};

/** A driver on a brand's goal: the master's numbers plus what the brand's own results have taught. */
export type GoalDriver = DriverSpec & {
  enabled: boolean;
  /** The benchmark yield the goal started with; learning is pulled toward it. */
  priorYield: number;
};

/**
 * The plan in force: the path's current anchor and what it asks of each
 * activity this week. Stored on the goal and in every revision.
 */
export type GoalPlan = {
  /** Where the path starts now — the goal's start, or the actual at the last recalibration. */
  anchorDate: string;
  anchorValue: number;
  /** First day of the seven the volumes were worked out for (the day after the anchor). */
  weekStart: string;
  /** Gain the path asks for that week (a flow's count for the week). */
  required: number;
  /** Audience the audience-scaled yields were worked at. */
  audience: number;
  /** Whole units per week, by activity code. */
  units: Record<string, number>;
  /** Gain each driver is expected to bring that week. */
  gains: Record<string, number>;
  /** Period targets written to the activity checklists, by activity code. */
  targets: Record<string, number>;
  shortfall: number;
  feasible: boolean;
  /** When full capacity reaches the target. */
  reachDate: string | null;
  /** Where full capacity gets by the deadline. */
  atDeadline: number;
  hoursPerWeek: number;
};

export const REVISION_KINDS = ["initial", "recalibration", "edit"] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];
export const REVISION_STATUSES = ["applied", "proposed", "rejected", "superseded"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** Granularities the progress view can show. */
export const GOAL_GRAINS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type GoalGrain = (typeof GOAL_GRAINS)[number];

/** 1234 → "1.2k", 1_000_000 → "1M". */
export function compact(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e4) return `${sign}${trim(abs / 1e3)}k`;
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
}
const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

const PER: Record<string, string> = {
  daily: "a day", every_2_days: "every 2 days", weekly: "a week", monthly: "a month",
  quarterly: "a quarter", half_yearly: "every 6 months", yearly: "a year",
};

/** A checklist target in words: "3 a day", "2 every 2 days". */
export function perPeriodText(target: number, frequency: string) {
  return `${target} ${PER[frequency] ?? ""}`.trim();
}

/** One unit of a driver: "stories" → "story", "launches" → "launch", "DMs" → "DM". */
export function singular(unit: string) {
  if (/ies$/i.test(unit)) return unit.replace(/ies$/i, "y");
  if (/(ch|sh|x|ss)es$/i.test(unit)) return unit.replace(/es$/i, "");
  return unit.replace(/s$/, "");
}
