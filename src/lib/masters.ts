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
  return inheritState(MASTER_FIELDS, copy, snapshot, master);
}

/**
 * The same comparison for any master/copy pair — posts, campaigns, and
 * whatever follows — given the fields that inherit, as normalised strings.
 */
export function inheritState<F extends string>(
  fields: readonly F[],
  copy: Record<F, string>,
  snapshot: Partial<Record<F, string>>,
  master: Record<F, string>,
): { customised: F[]; pending: F[] } {
  const customised: F[] = [];
  const pending: F[] = [];
  for (const f of fields) {
    const base = snapshot[f] ?? master[f];
    if (copy[f] !== base && copy[f] !== master[f]) customised.push(f);
    if (master[f] !== base && copy[f] !== master[f]) pending.push(f);
  }
  return { customised, pending };
}

/**
 * One sync step for any master/copy pair: which fields to write from the
 * master, and the snapshot that results. `locked` copies only take what they
 * are told to accept.
 */
export function planSync<F extends string>(
  fields: readonly F[],
  copy: Record<F, string>,
  snapshot: Partial<Record<F, string>>,
  master: Record<F, string>,
  opts: { accept?: F[]; keep?: F[]; locked?: boolean } = {},
) {
  const state = inheritState(fields, copy, snapshot, master);
  const next: Partial<Record<F, string>> = {};
  const nextSnapshot: Partial<Record<F, string>> = { ...snapshot };
  for (const f of fields) {
    const take = opts.accept?.includes(f)
      || (state.pending.includes(f) && !state.customised.includes(f) && !opts.locked);
    if (take && copy[f] !== master[f]) next[f] = master[f];
    // In step with the master, or told to be: either way this is the new base.
    if (take || opts.keep?.includes(f) || copy[f] === master[f]) nextSnapshot[f] = master[f];
  }
  return { next, snapshot: nextSnapshot };
}
