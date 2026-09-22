/**
 * Which parts of a saved link destination a brand copy inherits from its
 * master. Client-safe; the inheritance rules are the shared ones in
 * `src/lib/masters.ts`.
 */

export const DEST_FIELDS = ["name", "url", "utmCampaign", "utmContent"] as const;
export type DestField = (typeof DEST_FIELDS)[number];
export type DestValues = Record<DestField, string>;

export const DEST_FIELD_LABELS: Record<DestField, string> = {
  name: "Name",
  url: "URL",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
};

type Row = { name: string; url: string; utmCampaign: string | null; utmContent: string | null };

export function destValues(r: Row): DestValues {
  return { name: r.name, url: r.url, utmCampaign: r.utmCampaign ?? "", utmContent: r.utmContent ?? "" };
}

export function destColumns(v: Partial<DestValues>): Partial<Row> {
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v) as [DestField, string][]) {
    out[k] = k === "name" || k === "url" ? value : value || null;
  }
  return out as Partial<Row>;
}

/** What the link pickers offer. */
export type DestinationOption = {
  id: string; name: string; url: string; utmCampaign: string | null;
  /** A master destination this brand has no copy of. */
  fromMaster: boolean;
};
