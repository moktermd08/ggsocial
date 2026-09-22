import type { DriverSpec, GoalMetric } from "./meta";

/**
 * The built-in master goal templates. Seeded by `code` like the activity
 * library: missing codes are inserted on the next request, and edits made in
 * the app are never overwritten.
 *
 * Yields are conservative starting benchmarks for a small-to-mid account.
 * They are only a prior: each brand's goal re-learns them from its own
 * results every week, so a wrong guess here costs a few weeks, not the goal.
 * Audience-scaled yields are per unit per 1,000 of the current audience.
 *
 * Shares in each template add up to 1.
 */
export type LibraryGoal = {
  code: string;
  metric: GoalMetric;
  name: string;
  description: string;
  drivers: DriverSpec[];
};

type D = [activityCode: string, label: string, unitLabel: string, yieldPerUnit: number, share: number, maxPerWeek: number, scale?: "audience"];

const drivers = (rows: D[]): DriverSpec[] =>
  rows.map(([activityCode, label, unitLabel, y, share, maxPerWeek, scale]) => ({
    activityCode, label, unitLabel, yield: y, share, maxPerWeek, scale: scale ?? "fixed",
  }));

export const GOAL_LIBRARY: LibraryGoal[] = [
  {
    code: "G-FOLLOWERS",
    metric: "followers",
    name: "Grow followers",
    description: "Reach a follower count by a date. Content carries more of the load as the audience grows; outbound work (comments, requests, groups) gets the early momentum.",
    drivers: drivers([
      ["2D-01", "Short-form videos", "videos", 1.2, 0.3, 14, "audience"],
      ["D-01", "Feed posts", "posts", 0.3, 0.15, 14, "audience"],
      ["W-04", "Carousels", "carousels", 0.6, 0.05, 7, "audience"],
      ["D-17", "Stories", "stories", 0.05, 0.05, 21, "audience"],
      ["M-20", "Collab posts", "collabs", 3, 0.05, 2, "audience"],
      ["D-05", "Comments on prospects' posts", "comments", 0.4, 0.1, 140],
      ["D-07", "Follow / connection requests", "requests", 0.25, 0.1, 140],
      ["W-12", "Value posts in groups", "group posts", 12, 0.1, 10],
      ["W-11", "Groups joined", "groups", 3, 0.05, 10],
      ["D-14", "Answers in groups and forums", "answers", 1.5, 0.05, 35],
    ]),
  },
  {
    code: "G-VISITORS",
    metric: "site_visitors",
    name: "Drive site visitors",
    description: "Reach a number of monthly visitors from social. Counted from tracked links, so put one in every post that should send traffic.",
    drivers: drivers([
      ["D-01", "Feed posts with a link", "posts", 6, 0.25, 21],
      ["2D-01", "Short-form videos", "videos", 4, 0.1, 14],
      ["D-17", "Stories with a link sticker", "stories", 3, 0.1, 21],
      ["W-12", "Value posts in groups", "group posts", 15, 0.15, 10],
      ["D-14", "Answers in groups and forums", "answers", 2, 0.1, 35],
      ["W-02", "Long-form pieces", "articles", 30, 0.15, 3],
      ["W-24", "Email newsletters", "sends", 80, 0.15, 1],
    ]),
  },
  {
    code: "G-COMMENTS",
    metric: "comments",
    name: "Get more comments",
    description: "Reach a number of comments a month on our posts. Questions and polls earn the most; commenting elsewhere earns some back.",
    drivers: drivers([
      ["D-01", "Feed posts", "posts", 3, 0.3, 21],
      ["2D-01", "Short-form videos", "videos", 5, 0.25, 14],
      ["W-03", "Polls and question posts", "polls", 8, 0.15, 4],
      ["D-05", "Comments on prospects' posts", "comments", 0.15, 0.15, 140],
      ["D-06", "Comments on industry voices", "comments", 0.1, 0.05, 70],
      ["W-18", "Public thank-yous to top engagers", "shout-outs", 4, 0.1, 2],
    ]),
  },
  {
    code: "G-MESSAGES",
    metric: "messages",
    name: "Start more conversations",
    description: "Reach a number of inbound messages a month. Value-first DMs, story interactions and clear invitations are what make people write back.",
    drivers: drivers([
      ["W-08", "Value-first DMs", "DMs", 0.3, 0.3, 50],
      ["D-07", "Follow / connection requests", "requests", 0.08, 0.15, 140],
      ["D-17", "Stories", "stories", 0.6, 0.15, 21],
      ["W-07", "Story Q&As and quizzes", "Q&As", 4, 0.15, 3],
      ["M-23", "Invitations to an offer or event", "invitations", 10, 0.15, 1],
      ["W-09", "Messages to profile viewers", "messages", 0.25, 0.1, 30],
    ]),
  },
  {
    code: "G-ENGAGEMENT",
    metric: "engagement",
    name: "Lift engagement",
    description: "Reach a number of likes, comments, shares and saves a month. Video and carousels do the heavy lifting.",
    drivers: drivers([
      ["D-01", "Feed posts", "posts", 35, 0.3, 21],
      ["2D-01", "Short-form videos", "videos", 70, 0.3, 14],
      ["W-04", "Carousels", "carousels", 55, 0.15, 7],
      ["W-03", "Polls and question posts", "polls", 45, 0.1, 4],
      ["D-05", "Comments on prospects' posts", "comments", 0.5, 0.1, 140],
      ["W-21", "Repurposed best posts", "reposts", 40, 0.05, 2],
    ]),
  },
  {
    code: "G-REACH",
    metric: "reach",
    name: "Reach more people",
    description: "Reach a number of people a month. Short video and collaborations travel furthest.",
    drivers: drivers([
      ["D-01", "Feed posts", "posts", 400, 0.3, 21],
      ["2D-01", "Short-form videos", "videos", 900, 0.35, 14],
      ["W-04", "Carousels", "carousels", 600, 0.1, 7],
      ["D-11", "Shares with our comment", "shares", 30, 0.05, 14],
      ["W-12", "Value posts in groups", "group posts", 500, 0.1, 10],
      ["M-20", "Collab posts", "collabs", 3000, 0.1, 2],
    ]),
  },
  {
    code: "G-LEADS",
    metric: "leads",
    name: "Generate leads",
    description: "Reach a number of leads a month from social. Conversations and offers convert; follow-ups rescue the ones that went quiet.",
    drivers: drivers([
      ["W-08", "Value-first DMs", "DMs", 0.05, 0.3, 50],
      ["D-14", "Answers in groups and forums", "answers", 0.03, 0.1, 35],
      ["M-23", "Invitations to an offer or event", "invitations", 2, 0.2, 1],
      ["Q-07", "Lead magnet launches", "launches", 25, 0.15, 1],
      ["2D-04", "Follow-ups with quiet leads", "follow-ups", 0.08, 0.15, 21],
      ["W-05", "Testimonials and results", "posts", 0.5, 0.1, 2],
    ]),
  },
];
