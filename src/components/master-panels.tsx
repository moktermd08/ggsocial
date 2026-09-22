"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Layers, MessageSquare, Plus, Unlink, X } from "lucide-react";
import { Badge, Card, CardHeader, buttonClass } from "./ui";
import { STATUS_META, relativeTime } from "@/lib/format";
import { MASTER_FIELD_LABELS, type MasterField } from "@/lib/masters";
import type { PostStatus } from "@/lib/db/schema";
import {
  addMasterCommentAction, addMasterCopiesAction, removeMasterCopyAction, resolveCopyFieldAction, unlinkCopyAction,
} from "@/server/actions/masters";

export type MasterCommentRow = { id: string; body: string; author: string; createdAt: string };
export type MasterCopyRow = {
  postId: string; brandId: string; brandName: string; brandColor: string; status: PostStatus;
  customised: MasterField[]; pending: MasterField[]; canEdit: boolean; locked: boolean;
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    start(async () => {
      try { await fn(); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    });
  };
  return { pending, error, run };
}

const fieldList = (fields: MasterField[]) => fields.map((f) => MASTER_FIELD_LABELS[f].toLowerCase()).join(", ");

/** On the master: where it has been carried, and how far each brand has taken it. */
export function MasterCopiesPanel({
  masterId, copies, addable,
}: {
  masterId: string;
  copies: MasterCopyRow[];
  /** Brands without a copy that this person can write to. */
  addable: { id: string; name: string; color: string }[];
}) {
  const { pending, error, run } = useRun();
  return (
    <Card>
      <CardHeader title="Brand copies" subtitle={`${copies.length} brand${copies.length === 1 ? "" : "s"}`} />
      <div className="space-y-1.5 p-3">
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
        {copies.length === 0 && <p className="px-1 py-2 text-sm text-muted">Not in any brand yet.</p>}
        {copies.map((c) => {
          const meta = STATUS_META[c.status];
          return (
            <div key={c.postId} className="rounded-lg border border-border px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="size-3 shrink-0 rounded" style={{ background: c.brandColor }} />
                <Link href={`/posts/${c.postId}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {c.brandName}
                </Link>
                <Badge color={meta.color}>{meta.label}</Badge>
                {c.canEdit && !c.locked && (
                  <button
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Remove the ${c.brandName} copy? Its draft is deleted.`)) run(() => removeMasterCopyAction(c.postId));
                    }}
                    className="rounded p-0.5 text-muted hover:text-danger"
                    title="Remove this brand's copy"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {c.customised.length ? `Customised: ${fieldList(c.customised)}` : "Follows the master"}
              </p>
              {c.pending.length > 0 && (
                <p className="mt-0.5 text-[11px] text-warn">
                  {c.pending.length} master change{c.pending.length === 1 ? "" : "s"} waiting: {fieldList(c.pending)}
                </p>
              )}
            </div>
          );
        })}
        {addable.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {addable.map((b) => (
              <button
                key={b.id}
                disabled={pending}
                onClick={() => run(() => addMasterCopiesAction(masterId, [b.id]))}
                className={buttonClass("subtle", "sm")}
              >
                <Plus className="size-3" />
                <span className="size-2 rounded-full" style={{ background: b.color }} /> {b.name}
              </button>
            ))}
            {addable.length > 1 && (
              <button
                disabled={pending}
                onClick={() => run(() => addMasterCopiesAction(masterId, addable.map((b) => b.id)))}
                className={buttonClass("ghost", "sm")}
              >
                Add to all
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Discussion on the master, seen from the master and from every copy. */
export function MasterComments({ masterId, comments, title = "Master comments" }: {
  masterId: string; comments: MasterCommentRow[]; title?: string;
}) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader title={title} subtitle={comments.length ? `${comments.length} comment${comments.length === 1 ? "" : "s"}` : "Shared with every brand"} />
      <div className="space-y-3 p-3">
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface-2 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="font-medium text-text">{c.author}</span>
                <span>{relativeTime(c.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          ))}
          {comments.length === 0 && <p className="py-2 text-center text-sm text-muted">No comments yet.</p>}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment for every brand…" />
        <button
          disabled={pending || !note.trim()}
          onClick={() => run(async () => { await addMasterCommentAction(masterId, note); setNote(""); })}
          className={buttonClass("subtle", "sm")}
        >
          <MessageSquare className="size-3.5" /> Comment
        </button>
      </div>
    </Card>
  );
}

/**
 * On a brand copy: what the master says, and any master change this brand
 * has not taken yet — each one a choice between the master's version and the
 * brand's own.
 */
export function CopyMasterPanel({
  postId, masterId, masterTitle, guidelines, notes, pending: waiting, customised, masterValues, canEdit,
}: {
  postId: string;
  masterId: string;
  masterTitle: string;
  guidelines: string | null;
  notes: string | null;
  pending: MasterField[];
  customised: MasterField[];
  /** Readable master values for the waiting fields. */
  masterValues: Partial<Record<MasterField, string>>;
  canEdit: boolean;
}) {
  const { pending, error, run } = useRun();
  return (
    <Card>
      <CardHeader
        icon={Layers}
        title="From master"
        subtitle={masterTitle || "Untitled master"}
        action={
          <Link href={`/posts/master/${masterId}`} className={buttonClass("ghost", "sm")} title="Open the master">
            <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />
      <div className="space-y-3 p-3 text-sm">
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}

        {waiting.length > 0 && (
          <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5">
            <p className="text-xs font-medium text-warn">The master has changed</p>
            {waiting.map((f) => (
              <div key={f} className="space-y-1">
                <p className="text-xs font-medium">{MASTER_FIELD_LABELS[f]}</p>
                <p className="line-clamp-4 whitespace-pre-wrap rounded border border-border bg-surface px-2 py-1 text-xs text-muted">
                  {masterValues[f] || "(empty)"}
                </p>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <button disabled={pending} onClick={() => run(() => resolveCopyFieldAction(postId, f, "accept"))} className={buttonClass("primary", "sm")}>
                      Use master
                    </button>
                    <button disabled={pending} onClick={() => run(() => resolveCopyFieldAction(postId, f, "keep"))} className={buttonClass("subtle", "sm")}>
                      Keep ours
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {guidelines && (
          <div>
            <p className="text-xs font-medium text-muted">Guidelines</p>
            <p className="mt-0.5 whitespace-pre-wrap">{guidelines}</p>
          </div>
        )}
        {notes && (
          <div>
            <p className="text-xs font-medium text-muted">Master notes</p>
            <p className="mt-0.5 whitespace-pre-wrap text-muted">{notes}</p>
          </div>
        )}

        <p className="text-[11px] text-muted">
          {customised.length
            ? `Customised for this brand: ${fieldList(customised)}. Everything else follows the master.`
            : "Nothing customised yet: this copy follows the master. Edit any field to make it this brand's own."}
        </p>

        {canEdit && (
          <button
            disabled={pending}
            onClick={() => {
              if (confirm("Stop following the master? This post keeps its current content.")) run(() => unlinkCopyAction(postId));
            }}
            className={buttonClass("ghost", "sm")}
          >
            <Unlink className="size-3.5" /> Unlink from master
          </button>
        )}
      </div>
    </Card>
  );
}
