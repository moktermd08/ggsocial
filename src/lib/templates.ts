/**
 * Which parts of a post template a brand copy inherits from its master, and
 * the placeholder convention templates use. Client-safe; the inheritance rules
 * are the shared ones in `src/lib/masters.ts`.
 */

export const TEMPLATE_FIELDS = [
  "name", "description", "title", "body", "postType", "platforms", "hashtags", "firstComment",
] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];
export type TemplateValues = Record<TemplateField, string>;

export const TEMPLATE_FIELD_LABELS: Record<TemplateField, string> = {
  name: "Name",
  description: "When to use it",
  title: "Title",
  body: "Body",
  postType: "Post type",
  platforms: "Platforms",
  hashtags: "Hashtags",
  firstComment: "First comment",
};

export const POST_TYPES = ["Hook", "Carousel", "Case study", "How-to", "Announcement", "Poll", "Behind the scenes", "Testimonial"];

type Row = {
  name: string; description: string | null; title: string; body: string; postType: string | null;
  platforms: string[]; hashtags: string[]; firstComment: string | null;
};

const JSON_FIELDS = new Set<TemplateField>(["platforms", "hashtags"]);
const NULLABLE = new Set<TemplateField>(["description", "postType", "firstComment"]);

export function templateValues(r: Row): TemplateValues {
  const out = {} as TemplateValues;
  for (const f of TEMPLATE_FIELDS) {
    const v = r[f];
    out[f] = JSON_FIELDS.has(f) ? JSON.stringify(v) : (v as string | null) ?? "";
  }
  return out;
}

export function templateColumns(v: Partial<TemplateValues>): Partial<Row> {
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v) as [TemplateField, string][]) {
    if (JSON_FIELDS.has(k)) out[k] = JSON.parse(value || "[]");
    else if (NULLABLE.has(k)) out[k] = value || null;
    else out[k] = value;
  }
  return out as Partial<Row>;
}

export function readableTemplateValue(f: TemplateField, v: string) {
  return JSON_FIELDS.has(f) ? (JSON.parse(v || "[]") as string[]).join(", ") : v;
}

/**
 * Placeholders are square-bracketed prompts that start with a capital —
 * "[Hook: the surprising number]", "[Client name]" — so ordinary brackets in
 * copy, like "[sic]" or "(see [1])", are left alone.
 */
const PLACEHOLDER = /\[[A-Z][^\]\n]{0,60}\]/g;

export function findPlaceholders(text: string) {
  return [...new Set(text.match(PLACEHOLDER) ?? [])];
}

/** What a template offers the composer. */
export type TemplateOption = {
  id: string; name: string; description: string | null; title: string; body: string;
  postType: string | null; platforms: string[]; hashtags: string[]; firstComment: string | null;
  /** True when this is a master template the brand has no copy of. */
  fromMaster: boolean;
};
