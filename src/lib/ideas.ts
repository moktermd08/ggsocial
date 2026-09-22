/**
 * Which parts of a content-plan idea a brand's version inherits, and how each
 * is compared. Client-safe; the inheritance rules are the shared ones in
 * `src/lib/masters.ts`. Status and sequence stay with the plan itself.
 */

export const IDEA_FIELDS = [
  "title", "problem", "action", "outcome", "postType", "tone", "hashtags", "targetImpressions",
] as const;
export type IdeaField = (typeof IDEA_FIELDS)[number];
export type IdeaValues = Record<IdeaField, string>;

export const IDEA_FIELD_LABELS: Record<IdeaField, string> = {
  title: "Working title",
  problem: "Problem",
  action: "What you do about it",
  outcome: "Outcome",
  postType: "Type",
  tone: "Tone",
  hashtags: "Hashtags",
  targetImpressions: "Target impressions",
};

type Row = {
  title: string; problem: string; action: string | null; outcome: string | null;
  postType: string | null; tone: string | null; hashtags: string[]; targetImpressions: number | null;
};

export function ideaValues(r: Row): IdeaValues {
  return {
    title: r.title,
    problem: r.problem,
    action: r.action ?? "",
    outcome: r.outcome ?? "",
    postType: r.postType ?? "",
    tone: r.tone ?? "",
    hashtags: JSON.stringify(r.hashtags),
    targetImpressions: r.targetImpressions == null ? "" : String(r.targetImpressions),
  };
}

export function ideaColumns(v: Partial<IdeaValues>): Partial<Row> {
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v) as [IdeaField, string][]) {
    if (k === "hashtags") out[k] = JSON.parse(value || "[]");
    else if (k === "targetImpressions") out[k] = value === "" ? null : Number(value);
    else if (k === "title" || k === "problem") out[k] = value;
    else out[k] = value || null;
  }
  return out as Partial<Row>;
}

export function readableIdeaValue(f: IdeaField, v: string) {
  return f === "hashtags" ? (JSON.parse(v || "[]") as string[]).join(" ") : v;
}

/** A brand's version as the plan grid sees it. `values` are what the brand actually tells. */
export type IdeaVersionView = {
  id: string;
  values: IdeaValues;
  customised: IdeaField[];
  pending: IdeaField[];
  angle: string | null;
  notes: string | null;
  skipped: boolean;
};
