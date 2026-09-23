"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, BookCheck, CircleCheck, MessageSquare, ThumbsUp, Undo2 } from "lucide-react";
import { PlatformIcon } from "./platform-icon";
import type { ChecklistItem } from "@/lib/playbook/meta";
import { Card, CardHeader, buttonClass } from "./ui";
import { addCommentAction, reviewPostAction, submitForReviewAction } from "@/server/actions/posts";
import type { ActionResult } from "@/lib/action-result";
import { relativeTime } from "@/lib/format";

export type CommentRow = { id: string; body: string; kind: string; createdAt: string; author: string };

/** One channel of the post against its playbook rule, as saved. */
export type PlaybookResult = {
  channelId: string; handle: string; platform: string;
  rule: { code: string; name: string } | null;
  issues: { level: "error" | "warn"; message: string }[];
  checklist: ChecklistItem[];
};

export function ReviewPanel({
  postId, status, comments, canApprove, canEdit, playbook = [],
}: {
  postId: string;
  status: string;
  comments: CommentRow[];
  canApprove: boolean;
  canEdit: boolean;
  playbook?: PlaybookResult[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Each point once, however many channels or rules carry it. Agent-only points are the agent's to meet.
  const points = [...new Map(playbook.flatMap((r) => r.checklist).filter((i) => i.for !== "agent").map((i) => [i.text, i])).values()];
  const blocking = playbook.some((r) => r.issues.some((i) => i.level === "error"));
  const reviewing = canApprove && status === "in_review";
  const allTicked = points.every((p) => ticked.has(p.id));

  /**
   * Waits for the action and shows why it failed. The note is only cleared on
   * success, so a reviewer who hits a problem does not lose what they wrote.
   */
  const run = (fn: () => Promise<ActionResult>) => start(async () => {
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) { setError(res.error); return; }
      setNote("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
  });

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

        {playbook.some((r) => r.rule) && (
          <div className="space-y-2 rounded-lg border border-border p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <BookCheck className="size-3.5 text-muted" /> Playbook check
              <Link href="/playbook" className="ml-auto text-[11px] font-normal text-muted hover:underline">rules</Link>
            </p>
            <ul className="space-y-1.5 text-xs">
              {playbook.filter((r) => r.rule).map((r) => (
                <li key={r.channelId}>
                  <span className="flex items-center gap-1.5">
                    <PlatformIcon platform={r.platform} size={14} />
                    <span className="min-w-0 flex-1 truncate">{r.handle} <span className="text-muted">· {r.rule!.name}</span></span>
                    {r.issues.length === 0 && <CircleCheck className="size-3.5 text-ok" aria-label="Meets the playbook" />}
                  </span>
                  {r.issues.map((i, n) => (
                    <span key={n} className={`mt-0.5 flex items-start gap-1 pl-5 ${i.level === "error" ? "text-danger" : "text-warn"}`}>
                      <AlertCircle className="mt-0.5 size-3 shrink-0" /> {i.message}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {points.length > 0 && (
              <div className="border-t border-border pt-2">
                <p className="mb-1 text-[11px] text-muted">{reviewing ? "Confirm each point to approve" : "Points the reviewer confirms"}</p>
                <ul className="space-y-1 text-xs">
                  {points.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-start gap-1.5">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5"
                          disabled={!reviewing}
                          checked={ticked.has(p.id)}
                          onChange={(e) => setTicked((t) => { const n = new Set(t); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })}
                        />
                        <span>{p.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
          </p>
        )}

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
                disabled={pending || blocking || !allTicked}
                title={blocking ? "A playbook rule is broken — request changes." : !allTicked ? "Tick every playbook point first." : undefined}
                onClick={() => run(() => reviewPostAction(postId, "approve", note, [...ticked]))}
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
