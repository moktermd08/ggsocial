/**
 * Which parts of a brand's book follow the master brand book, and how each is
 * compared. Client-safe. The inheritance rules are the shared ones in
 * `src/lib/masters.ts`.
 *
 * Identity — name, logo, palette, colour, timezone, company profile — is left
 * out on purpose: that is what makes each brand itself. So are internal notes.
 */
import type { BrandLink, EmojiPolicy } from "@/lib/db/schema";

export const BOOK_FIELDS = [
  "brief", "voice", "audience", "valueProps", "bannedWords", "defaultHashtags", "emojiPolicy",
  "ctaText", "boilerplate", "fontHeading", "fontBody", "logoUsage", "imageStyle", "links",
] as const;
export type BookField = (typeof BOOK_FIELDS)[number];
export type BookValues = Record<BookField, string>;

export const BOOK_FIELD_LABELS: Record<BookField, string> = {
  brief: "Brief",
  voice: "Tone of voice",
  audience: "Audience",
  valueProps: "Key messages",
  bannedWords: "Words to avoid",
  defaultHashtags: "Default hashtags",
  emojiPolicy: "Emoji policy",
  ctaText: "Default call to action",
  boilerplate: "Boilerplate",
  fontHeading: "Heading typeface",
  fontBody: "Body typeface",
  logoUsage: "Logo usage",
  imageStyle: "Image style",
  links: "Links",
};

export const EMOJI_LABELS: Record<EmojiPolicy, string> = {
  free: "Emoji are fine",
  sparing: "Sparingly — one or two at most",
  none: "Never use emoji",
};

export type BookRow = {
  brief: string | null; voice: string | null; audience: string | null;
  valueProps: string[]; bannedWords: string[]; defaultHashtags: string[]; emojiPolicy: EmojiPolicy;
  ctaText: string | null; boilerplate: string | null; fontHeading: string | null; fontBody: string | null;
  logoUsage: string | null; imageStyle: string | null; links: BrandLink[];
};

const JSON_FIELDS = new Set<BookField>(["valueProps", "bannedWords", "defaultHashtags", "links"]);

export function bookValues(r: BookRow): BookValues {
  const out = {} as BookValues;
  for (const f of BOOK_FIELDS) {
    const v = r[f];
    out[f] = JSON_FIELDS.has(f) ? JSON.stringify(v) : (v as string | null) ?? "";
  }
  return out;
}

export function bookColumns(v: Partial<BookValues>): Partial<BookRow> {
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v) as [BookField, string][]) {
    if (JSON_FIELDS.has(k)) out[k] = JSON.parse(value || "[]");
    else if (k === "emojiPolicy") out[k] = value || "free";
    else out[k] = value || null;
  }
  return out as Partial<BookRow>;
}

/** A field with nothing in it yet — linking a brand fills these from the master. */
export function isEmptyBookValue(f: BookField, v: string) {
  return JSON_FIELDS.has(f) ? v === "[]" : f === "emojiPolicy" ? false : v === "";
}

export function readableBookValue(f: BookField, v: string) {
  if (f === "links") return (JSON.parse(v || "[]") as BrandLink[]).map((l) => `${l.label}: ${l.url}`).join("\n");
  if (JSON_FIELDS.has(f)) return (JSON.parse(v || "[]") as string[]).join(", ");
  if (f === "emojiPolicy") return EMOJI_LABELS[v as EmojiPolicy] ?? v;
  return v;
}
