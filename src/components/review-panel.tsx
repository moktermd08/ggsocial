"use client";
import { useState, useTransition } from "react";
import { MessageSquare, ThumbsUp, Undo2 } from "lucide-react";
import { Card, CardHeader, buttonClass } from "./ui";
import { addCommentAction, reviewPostAction, submitForReviewAction } from "@/server/actions/posts";
import { relativeTime } from "@/lib/format";

export type CommentRow = { id: string; body: string; kind: string; createdAt: string; author: string };

export function ReviewPanel({
  postId, status, comments, canApprove, canEdit,
}: {
  postId: string;
  status: string;
  comments: CommentRow[];
  canApprove: boolean;
  canEdit: boolean;
}) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<unknown>) => start(() => { void fn(); setNote(""); });

  return (
    <Card>
      <CardHeader title="Review" subtitle={comments.length ? `${comments.length} note(s)` : "No notes yet"} />
      <div className="space-y-3 p-3">
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface-2 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="font-medium text-text">{c.author}</span>
                <span>{relativeTime(c.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm">{c.body}</p>
              {c.kind !== "comment" && (
                <p className={`mt-1 text-[11px] ${c.kind === "approved" ? "text-ok" : "text-danger"}`}>
                  {c.kind === "approved" ? "Approved" : "Changes requested"}
                </p>
              )}
            </div>
          ))}
          {comments.length === 0 && <p className="py-3 text-center text-sm text-muted">Nothing here yet.</p>}
        </div>

        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Leave a note…"
        />

        <div className="flex flex-wrap gap-2">
          <button
            disabled={pending || !note.trim()}
            onClick={() => run(() => addCommentAction(postId, note))}
            className={buttonClass("subtle", "sm")}
          >
            <MessageSquare className="size-3.5" /> Comment
          </button>

          {canApprove && status === "in_review" && (
            <>
              <button
                disabled={pending}
                onClick={() => run(() => reviewPostAction(postId, "approve", note))}
                className={buttonClass("primary", "sm")}
              >
                <ThumbsUp className="size-3.5" /> Approve
              </button>
              <button
                disabled={pending}
                onClick={() => run(() => reviewPostAction(postId, "request_changes", note))}
                className={buttonClass("danger", "sm")}
              >
                <Undo2 className="size-3.5" /> Request changes
              </button>
            </>
          )}

          {canEdit && ["draft", "changes_requested"].includes(status) && (
            <button
              disabled={pending}
              onClick={() => run(() => submitForReviewAction(postId))}
              className={buttonClass("subtle", "sm")}
            >
              Submit for approval
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
