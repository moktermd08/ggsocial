"use client";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Layers, MessageSquare, Plus, Unlink, X } from "lucide-react";
import { Badge, Card, CardHeader, buttonClass } from "./ui";
import { STATUS_META, relativeTime } from "@/lib/format";
import { MASTER_FIELD_LABELS, type MasterField } from "@/lib/masters";
import type { PostStatus } from "@/lib/db/schema";
import {
  addMasterCommentAction, addMasterCopiesAction, removeMasterCopyAction,
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
export function MasterComments({
  masterId, comments, title = "Master comments", add, placeholder = "Comment for every brand…", emptyHint = "Shared with every brand",
}: {
  masterId?: string; comments: MasterCommentRow[]; title?: string;
  /** Where a new comment goes. Defaults to the master post's thread. */
  add?: (body: string) => Promise<void>;
  placeholder?: string;
  emptyHint?: string;
}) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader title={title} subtitle={comments.length ? `${comments.length} comment${comments.length === 1 ? "" : "s"}` : emptyHint} />
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
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} />
        <button
          disabled={pending || !note.trim()}
          onClick={() => run(async () => { await (add ? add(note) : addMasterCommentAction(masterId!, note)); setNote(""); })}
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
 * brand's own. Used for posts and campaigns alike.
 */
export function FromMasterPanel<F extends string>({
  href, masterTitle, guidelines, notes, pending: waiting, customised, masterValues, fieldLabels, canEdit,
  resolve, unlink, unlinkConfirm,
}: {
  /** The master's own page. */
  href: string;
  masterTitle: string;
  guidelines: string | null;
  notes: string | null;
  pending: F[];
  customised: F[];
  /** Readable master values for the waiting fields. */
  masterValues: Partial<Record<F, string>>;
  fieldLabels: Record<F, string>;
  canEdit: boolean;
  /** Bound server actions for this copy. */
  resolve: (field: F, choice: "accept" | "keep") => Promise<void>;
  unlink: () => Promise<void>;
  unlinkConfirm: string;
}) {
  const { pending, error, run } = useRun();
  const list = (fields: F[]) => fields.map((f) => fieldLabels[f].toLowerCase()).join(", ");
  return (
    <Card>
      <CardHeader
        icon={Layers}
        title="From master"
        subtitle={masterTitle || "Untitled master"}
        action={
          <Link href={href} className={buttonClass("ghost", "sm")} title="Open the master">
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
                <p className="text-xs font-medium">{fieldLabels[f]}</p>
                <p className="line-clamp-4 whitespace-pre-wrap rounded border border-border bg-surface px-2 py-1 text-xs text-muted">
                  {masterValues[f] || "(empty)"}
                </p>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <button disabled={pending} onClick={() => run(() => resolve(f, "accept"))} className={buttonClass("primary", "sm")}>
                      Use master
                    </button>
                    <button disabled={pending} onClick={() => run(() => resolve(f, "keep"))} className={buttonClass("subtle", "sm")}>
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
            ? `Customised for this brand: ${list(customised)}. Everything else follows the master.`
            : "Nothing customised yet: this follows the master. Edit any field to make it this brand's own."}
        </p>

        {canEdit && (
          <button
            disabled={pending}
            onClick={() => {
              if (confirm(unlinkConfirm)) run(unlink);
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

/** A field label with something on the right, such as a MasterTag. */
export function LabelRow({ text, tag }: { text: string; tag: ReactNode }) {
  return <span className="flex items-center justify-between gap-2">{text}{tag}</span>;
}

/** On a copy: whether a field follows the master or is this brand's own. */
export function MasterTag({ customised, onReset }: { customised: boolean; onReset: () => void }) {
  return customised ? (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-normal">
      <span className="text-accent">Customised</span>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); onReset(); }}
        className="text-muted hover:underline"
      >
        Reset to master
      </button>
    </span>
  ) : (
    <span className="text-[11px] font-normal text-muted">From master</span>
  );
}
