/**
 * The brand agents, importable from client components without pulling in drizzle.
 *
 * Each agent takes one slice of the day-to-day work off a person. What an
 * agent may do is fixed here in code, not in settings: an agent writes,
 * sorts and reports, and everything it makes goes through the same approval,
 * engagement queue and checklist a person's work does. A person sets the
 * guidelines and reviews the result; nothing an agent makes publishes by itself.
 */

export const AGENT_CODES = ["writer", "community", "analyst"] as const;
export type AgentCode = (typeof AGENT_CODES)[number];

export const AGENT_RUN_STATUSES = ["running", "succeeded", "idle", "failed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_STATUS_META: Record<AgentRunStatus, { label: string; color: string }> = {
  running: { label: "Running", color: "#4f46e5" },
  succeeded: { label: "Did work", color: "#15803d" },
  idle: { label: "Nothing to do", color: "#8b8b96" },
  failed: { label: "Failed", color: "#b91c1c" },
};

export type AgentRunTrigger = "schedule" | "manual";

/** Something a run made or touched, linked so a person can go straight to it. */
export type AgentRunItem = { kind: "post" | "interaction" | "check" | "note"; id: string | null; label: string; href?: string };

export type AgentUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; model: string };

/** A setting a person can change per brand. Values live in `brand_agents.settings`. */
export type AgentSettingField = {
  key: string;
  label: string;
  hint?: string;
  type: "number" | "channels";
  min?: number;
  max?: number;
};

export type AgentDef = {
  code: AgentCode;
  name: string;
  role: string;
  summary: string;
  /** What it does on each run, in order. */
  does: string[];
  /** Where its work stops and a person takes over. */
  handsOff: string[];
  /** The activity checklist rows it covers, fully or up to a person's sign-off. */
  activityCodes: string[];
  /** How long it waits between scheduled runs, in minutes. */
  everyMinutes: number;
  cadence: string;
  settings: AgentSettingField[];
  /** Placeholder for the guidelines box: the kind of thing worth telling it. */
  guidelineHint: string;
  color: string;
};

export const AGENTS: AgentDef[] = [
  {
    code: "writer",
    name: "Content writer",
    role: "Keeps the calendar full",
    summary: "Picks the next ideas from the content plan, writes each one in the brand's voice for every channel, books it into an open posting slot and sends it for approval.",
    does: [
      "Revises any post of its own that a reviewer sent back, working from the reviewer's note",
      "Finds the open slots in the next days, using the playbook's posting days, windows and posts per week",
      "Takes the next planned or backlog idea this brand has not told yet, in plan order",
      "Writes it for every chosen channel to the brand book and the playbook, then checks its own copy",
      "Books it into the slot and hands it to the 'Publish a planned post' workflow, which stops for review where the brand has review on",
    ],
    handsOff: [
      "Never skips a review that is on: an approver signs off every post until the brand's owner switches review off for writing, and safety stops still apply after that",
      "Never touches a post a person wrote",
      "Leaves media to people for now; a post that needs an image waits in the review inbox until one is attached",
    ],
    activityCodes: ["D-01"],
    everyMinutes: 60,
    cadence: "Hourly",
    settings: [
      { key: "daysAhead", label: "Plan this many days ahead", type: "number", min: 1, max: 30, hint: "Slots further out are left for later runs." },
      { key: "perWeek", label: "Posts per week", type: "number", min: 1, max: 21, hint: "Blank follows the playbook's feed-post rule, or 5." },
      { key: "perRun", label: "Most posts written per run", type: "number", min: 1, max: 5, hint: "Keeps each run's cost and review pile small." },
      { key: "channelIds", label: "Channels it writes for", type: "channels", hint: "None ticked = every channel on the brand." },
    ],
    guidelineHint: "e.g. Lead with a customer's words where the idea has them. No posts about pricing. Keep LinkedIn under 150 words.",
    color: "#4f46e5",
  },
  {
    code: "community",
    name: "Community manager",
    role: "Answers people, first draft",
    summary: "Reads every new comment, message, mention and review, drafts the reply in the brand's voice, sorts it by tone and urgency, and flags anything a person must handle.",
    does: [
      "Picks up new inbound engagement that has no reply yet",
      "Drafts a reply to the playbook's reply, message and review rules",
      "Sets tone (positive, neutral, negative, question) and priority",
      "Raises complaints, prices, refunds, legal and anything admitting fault to high priority for a person",
      "Hands each reply to the 'Answer a comment or message' workflow, which sends it on Facebook, Instagram and YouTube once it is approved",
    ],
    handsOff: [
      "Never skips a review that is on: every reply waits for a person until the brand's owner switches review off for replies, and safety stops still apply after that",
      "Never promises a price, a deadline or a refund",
    ],
    activityCodes: ["D-02", "D-03", "D-10", "D-13", "D-20"],
    everyMinutes: 15,
    cadence: "Every 15 minutes",
    settings: [
      { key: "perRun", label: "Most items per run", type: "number", min: 1, max: 25, hint: "Oldest first; the rest wait for the next run." },
    ],
    guidelineHint: "e.g. Sign replies with the first name of whoever is on shift. Send any mention of an outage straight to high priority.",
    color: "#0f766e",
  },
  {
    code: "analyst",
    name: "Performance analyst",
    role: "Reads the numbers every morning",
    summary: "Pulls fresh numbers each morning, compares yesterday's posts with the brand's usual, writes down what worked and what didn't, and ticks the daily performance check.",
    does: [
      "Refreshes metrics from every live channel",
      "Compares yesterday's posts with the last 30 days",
      "Writes a short note of what stood out and one thing to try",
      "Records the lesson on standout posts that have none yet, and ticks the daily check for review",
    ],
    handsOff: [
      "Never changes the playbook or a goal: those still go through their own approval",
    ],
    activityCodes: ["D-16"],
    everyMinutes: 60,
    cadence: "Daily, from 07:00 brand time",
    settings: [],
    guidelineHint: "e.g. Saves and shares matter more to us than likes. Ignore anything from the giveaway campaign.",
    color: "#475569",
  },
];

export const AGENT_BY_CODE = Object.fromEntries(AGENTS.map((a) => [a.code, a])) as Record<AgentCode, AgentDef>;

export function isAgentCode(v: unknown): v is AgentCode {
  return typeof v === "string" && (AGENT_CODES as readonly string[]).includes(v);
}

/** How the agent is named wherever its work is recorded — "done by" on a check, say. */
export function agentActorName(code: AgentCode) {
  return `${AGENT_BY_CODE[code].name} agent`;
}
