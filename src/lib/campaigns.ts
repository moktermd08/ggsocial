/**
 * Which parts of a campaign brief a brand copy inherits from its master, and
 * how each is compared. Client-safe. The inheritance rules themselves live in
 * `src/lib/masters.ts` and are shared with master posts.
 *
 * Status, notes and comments are deliberately left out: a brand runs its own
 * campaign on its own schedule, and its notes are its own.
 */
import type { CampaignStatus } from "@/lib/db/schema";

export const CAMPAIGN_FIELDS = [
  "name", "objective", "keyMessage", "audience", "cta", "landingUrl", "hashtags",
  "startDate", "endDate", "targetImpressions", "targetClicks", "targetLeads",
] as const;
export type CampaignField = (typeof CAMPAIGN_FIELDS)[number];
export type CampaignValues = Record<CampaignField, string>;

export const CAMPAIGN_FIELD_LABELS: Record<CampaignField, string> = {
  name: "Name",
  objective: "Objective",
  keyMessage: "Key message",
  audience: "Audience",
  cta: "Call to action",
  landingUrl: "Landing page",
  hashtags: "Hashtags",
  startDate: "Start date",
  endDate: "End date",
  targetImpressions: "Impressions target",
  targetClicks: "Clicks target",
  targetLeads: "Leads target",
};

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; color: string }> = {
  planning: { label: "Planning", color: "#6366f1" },
  active: { label: "Active", color: "#16a34a" },
  paused: { label: "Paused", color: "#d97706" },
  done: { label: "Done", color: "#64748b" },
};
export const CAMPAIGN_STATUS_LIST = Object.keys(CAMPAIGN_STATUS_META) as CampaignStatus[];

type Row = {
  name: string; objective: string | null; keyMessage: string | null; audience: string | null;
  cta: string | null; landingUrl: string | null; hashtags: string[];
  startDate: string | null; endDate: string | null;
  targetImpressions: number | null; targetClicks: number | null; targetLeads: number | null;
};

const NUMBER_FIELDS = new Set<CampaignField>(["targetImpressions", "targetClicks", "targetLeads"]);
const NULLABLE_TEXT = new Set<CampaignField>(["objective", "keyMessage", "audience", "cta", "landingUrl", "startDate", "endDate"]);

export function campaignValues(r: Row): CampaignValues {
  const out = {} as CampaignValues;
  for (const f of CAMPAIGN_FIELDS) {
    const v = r[f];
    out[f] = f === "hashtags" ? JSON.stringify(v) : v == null ? "" : String(v);
  }
  return out;
}

/** Back from the compared strings to column values. */
export function campaignColumns(v: Partial<CampaignValues>) {
  const out: Partial<Row> = {};
  for (const [k, value] of Object.entries(v) as [CampaignField, string][]) {
    if (k === "hashtags") out.hashtags = JSON.parse(value || "[]");
    else if (NUMBER_FIELDS.has(k)) (out as Record<string, unknown>)[k] = value === "" ? null : Number(value);
    else if (NULLABLE_TEXT.has(k)) (out as Record<string, unknown>)[k] = value || null;
    else (out as Record<string, unknown>)[k] = value;
  }
  return out;
}

/** "#launch #ai", "launch, ai" or one per line: all the same three-word list. */
export function parseHashtags(text: string) {
  return text.split(/[\s,]+/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean).map((t) => `#${t}`);
}

/** Readable form of a compared value, for "the master changed this to…". */
export function readableCampaignValue(f: CampaignField, v: string) {
  if (f === "hashtags") return (JSON.parse(v || "[]") as string[]).join(" ");
  if (NUMBER_FIELDS.has(f) && v) return Number(v).toLocaleString("en-GB");
  return v;
}
