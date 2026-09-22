/**
 * How a brand copy inherits from its master post. Client-safe: no database.
 *
 * Every inherited field is compared as a normalised string. A copy keeps a
 * snapshot of the master's values as of its last sync, which answers both
 * questions the UI asks per field:
 *
 *   customised — the copy's value differs from the snapshot
 *   pending    — the master has moved on since the snapshot
 *
 * A pending field that is not customised, on a copy nobody has signed off yet,
 * simply takes the master's new value. Everything else is offered to the
 * brand as a choice rather than written over.
 */
import type { MasterSnapshot } from "@/lib/db/schema";

export const MASTER_FIELDS = ["title", "body", "campaign", "tags", "scheduledAt", "media"] as const;
export type MasterField = (typeof MASTER_FIELDS)[number];
export type MasterValues = Record<MasterField, string>;

export const MASTER_FIELD_LABELS: Record<MasterField, string> = {
  title: "Title",
  body: "Copy",
  campaign: "Campaign",
  tags: "Tags",
  scheduledAt: "Publish time",
  media: "Media",
};

/**
 * Copies past this point have been approved or have gone out: a master edit
 * must not change them behind the approver's back.
 */
export const LOCKED_COPY_STATUSES = [
  "approved", "scheduled", "publishing", "published", "partially_published", "failed",
] as const;

export function isLockedStatus(status: string) {
  return (LOCKED_COPY_STATUSES as readonly string[]).includes(status);
}

type Source = {
  title: string; body: string; campaign: string | null; tags: string[];
  scheduledAt: Date | string | null; mediaIds: string[];
};

export function toValues(s: Source): MasterValues {
  return {
    title: s.title,
    body: s.body,
    campaign: s.campaign ?? "",
    tags: JSON.stringify(s.tags),
    scheduledAt: s.scheduledAt ? new Date(s.scheduledAt).toISOString() : "",
    media: JSON.stringify(s.mediaIds),
  };
}

/** Back from the normalised strings to what the posts table stores. */
export function fromValues(v: Partial<MasterValues>) {
  const out: {
    title?: string; body?: string; campaign?: string | null; tags?: string[];
    scheduledAt?: Date | null; mediaIds?: string[];
  } = {};
  if (v.title !== undefined) out.title = v.title;
  if (v.body !== undefined) out.body = v.body;
  if (v.campaign !== undefined) out.campaign = v.campaign || null;
  if (v.tags !== undefined) out.tags = JSON.parse(v.tags || "[]");
  if (v.scheduledAt !== undefined) out.scheduledAt = v.scheduledAt ? new Date(v.scheduledAt) : null;
  if (v.media !== undefined) out.mediaIds = JSON.parse(v.media || "[]");
  return out;
}

export type CopyState = {
  customised: MasterField[];
  pending: MasterField[];
};

export function copyState(copy: MasterValues, snapshot: MasterSnapshot, master: MasterValues): CopyState {
  const customised: MasterField[] = [];
  const pending: MasterField[] = [];
  for (const f of MASTER_FIELDS) {
    const base = snapshot[f] ?? master[f];
    if (copy[f] !== base && copy[f] !== master[f]) customised.push(f);
    if (master[f] !== base && copy[f] !== master[f]) pending.push(f);
  }
  return { customised, pending };
}
