"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus } from "lucide-react";
import { Badge, Card, CardHeader, buttonClass } from "./ui";
import { STATUS_META, truncate } from "@/lib/format";
import { CAMPAIGN_FIELD_LABELS, CAMPAIGN_STATUS_META, type CampaignField } from "@/lib/campaigns";
import type { CampaignStatus, PostStatus } from "@/lib/db/schema";
import { addCampaignCopiesAction } from "@/server/actions/campaigns";

export type CampaignCopyRow = {
  id: string; brandName: string; brandColor: string; status: CampaignStatus;
  customised: CampaignField[]; pending: CampaignField[]; posts: number; published: number;
};

const fieldList = (fields: CampaignField[]) => fields.map((f) => CAMPAIGN_FIELD_LABELS[f].toLowerCase()).join(", ");

/** On a master campaign: which brands run it, and how far each has taken it. */
export function CampaignCopiesPanel({ campaignId, copies, addable }: {
  campaignId: string;
  copies: CampaignCopyRow[];
  addable: { id: string; name: string; color: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const add = (ids: string[]) => {
    setError(null);
    start(async () => {
      try { await addCampaignCopiesAction(campaignId, ids); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not add."); }
    });
  };

  return (
    <Card>
      <CardHeader title="Brand copies" subtitle={`${copies.length} brand${copies.length === 1 ? "" : "s"} run this`} />
      <div className="space-y-1.5 p-3">
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
        {copies.length === 0 && <p className="px-1 py-2 text-sm text-muted">Not in any brand yet.</p>}
        {copies.map((c) => {
          const meta = CAMPAIGN_STATUS_META[c.status];
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block rounded-lg border border-border px-2.5 py-2 hover:bg-surface-2">
              <div className="flex items-center gap-2">
                <span className="size-3 shrink-0 rounded" style={{ background: c.brandColor }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.brandName}</span>
                <Badge color={meta.color}>{meta.label}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {c.posts} post{c.posts === 1 ? "" : "s"} · {c.published} published ·{" "}
                {c.customised.length ? `customised: ${fieldList(c.customised)}` : "follows the master"}
              </p>
              {c.pending.length > 0 && (
                <p className="mt-0.5 text-[11px] text-warn">
                  {c.pending.length} master change{c.pending.length === 1 ? "" : "s"} waiting: {fieldList(c.pending)}
                </p>
              )}
            </Link>
          );
        })}
        {addable.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {addable.map((b) => (
              <button key={b.id} disabled={pending} onClick={() => add([b.id])} className={buttonClass("subtle", "sm")}>
                <Plus className="size-3" />
                <span className="size-2 rounded-full" style={{ background: b.color }} /> {b.name}
              </button>
            ))}
            {addable.length > 1 && (
              <button disabled={pending} onClick={() => add(addable.map((b) => b.id))} className={buttonClass("ghost", "sm")}>
                Add to all
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export type CampaignPostRow = {
  id: string; title: string; body: string; status: PostStatus; when: string | null;
  brandName?: string; brandColor?: string; fromMaster: boolean;
};

/** The posts carrying this campaign's name, plus a way to write the next one. */
export function CampaignPostsPanel({ posts, masterPosts, newHref }: {
  posts: CampaignPostRow[];
  masterPosts?: { id: string; title: string; body: string }[];
  newHref?: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Posts"
        subtitle={`${posts.length} in this campaign`}
        action={newHref ? <Link href={newHref} className={buttonClass("subtle", "sm")}><Plus className="size-3.5" /> Post</Link> : undefined}
      />
      <div className="max-h-96 space-y-1 overflow-y-auto p-2">
        {masterPosts?.map((m) => (
          <Link key={m.id} href={`/posts/master/${m.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <Layers className="size-3.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{m.title || truncate(m.body, 50) || "Untitled"}</span>
            <Badge>Master</Badge>
          </Link>
        ))}
        {posts.map((p) => {
          const meta = STATUS_META[p.status];
          return (
            <Link key={p.id} href={`/posts/${p.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <div className="flex items-center gap-2 text-sm">
                {p.brandColor && <span className="size-2 shrink-0 rounded-full" style={{ background: p.brandColor }} title={p.brandName} />}
                <span className="min-w-0 flex-1 truncate">{p.title || truncate(p.body, 50) || "Untitled"}</span>
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: meta.color }} title={meta.label} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {meta.label}{p.when ? ` · ${p.when}` : ""}{p.fromMaster ? " · from master" : ""}
              </p>
            </Link>
          );
        })}
        {posts.length === 0 && !masterPosts?.length && (
          <p className="px-2 py-3 text-sm text-muted">No posts yet. A post joins by using this campaign&apos;s name.</p>
        )}
      </div>
    </Card>
  );
}

/** Beside a post: the brief of the campaign it belongs to, so the writer has it to hand. */
export function CampaignBriefCard({ campaign: c }: {
  campaign: {
    id: string; name: string; keyMessage: string | null; objective: string | null; cta: string | null;
    landingUrl: string | null; hashtags: string[]; audience: string | null; status: CampaignStatus;
  };
}) {
  const meta = CAMPAIGN_STATUS_META[c.status];
  const rows: [string, string | null][] = [
    ["Key message", c.keyMessage], ["Objective", c.objective], ["Audience", c.audience],
    ["Call to action", c.cta], ["Landing page", c.landingUrl],
    ["Hashtags", c.hashtags.length ? c.hashtags.join(" ") : null],
  ];
  return (
    <Card>
      <CardHeader
        title={<Link href={`/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>}
        subtitle="Campaign brief"
        action={<Badge color={meta.color}>{meta.label}</Badge>}
      />
      <dl className="space-y-2 p-3 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-medium text-muted">{k}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words">{v}</dd>
          </div>
        ))}
        {rows.every(([, v]) => !v) && <p className="text-muted">The brief is empty so far.</p>}
      </dl>
    </Card>
  );
}
