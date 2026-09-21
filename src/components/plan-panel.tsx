"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2 } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { toLocalInput, fromLocalInput } from "@/lib/format";
import { updatePostPlanAction } from "@/server/actions/ideas";

export type PlanPanelPost = {
  id: string;
  targetImpressions: number | null;
  keyLearning: string | null;
  notes: string | null;
  /** ISO, or null when nobody has been back to the comments yet. */
  repliedAt: string | null;
  publishedAt: string | null;
  timezone: string;
};

/**
 * The half of the plan that only makes sense per post: what this one was
 * aiming at, when you got back to the comments, and what it taught you.
 *
 * The numbers it reports on (impressions, comment counts) come from the
 * platforms, so they are never entered here.
 */
export function PlanPanel({
  post, idea, canEdit,
}: {
  post: PlanPanelPost;
  idea: { id: string; sequence: number; problem: string; pillar: string | null; title: string } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    targetImpressions: post.targetImpressions == null ? "" : String(post.targetImpressions),
    keyLearning: post.keyLearning ?? "",
    notes: post.notes ?? "",
    repliedAt: toLocalInput(post.repliedAt, post.timezone),
  });

  const replyGap =
    post.repliedAt && post.publishedAt
      ? Math.max(0, Math.round((new Date(post.repliedAt).getTime() - new Date(post.publishedAt).getTime()) / 60_000))
      : null;

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updatePostPlanAction({
          postId: post.id,
          targetImpressions: form.targetImpressions.trim() === ""
            ? null
            : Number(form.targetImpressions.replace(/\D/g, "")) || null,
          keyLearning: form.keyLearning,
          notes: form.notes,
          repliedAt: fromLocalInput(form.repliedAt, post.timezone)?.toISOString() ?? null,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Lightbulb className="size-4" /> Plan</span>}
        subtitle={idea ? `Idea ${idea.sequence}${idea.pillar ? ` · ${idea.pillar}` : ""}` : "Not linked to the plan"}
      />
      <div className="space-y-3 p-3">
        {idea && (
          <Link href="/ideas" className="block rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-xs hover:bg-surface">
            {idea.title || idea.problem}
          </Link>
        )}

        <Field label="Target impressions" hint="What this post is aiming at. Reached numbers come from the platform.">
          <input
            inputMode="numeric"
            value={form.targetImpressions}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, targetImpressions: e.target.value })}
            className="!py-1 !text-sm"
          />
        </Field>

        <Field
          label="Replied to comments"
          hint={replyGap === null ? undefined : `${replyGap < 60 ? `${replyGap} min` : `${(replyGap / 60).toFixed(1)} h`} after publishing.`}
        >
          <input
            type="datetime-local"
            value={form.repliedAt}
            disabled={!canEdit || !post.publishedAt}
            onChange={(e) => setForm({ ...form, repliedAt: e.target.value })}
            className="!py-1 !text-sm"
          />
        </Field>

        <Field label="Key learning">
          <textarea
            rows={2}
            value={form.keyLearning}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, keyLearning: e.target.value })}
            className="!py-1 !text-sm"
          />
        </Field>

        <Field label="Notes" hint="Internal. Never published.">
          <textarea
            rows={2}
            value={form.notes}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="!py-1 !text-sm"
          />
        </Field>

        {error && <p className="text-xs text-danger">{error}</p>}

        {canEdit && (
          <button onClick={save} disabled={pending} className={`${buttonClass("subtle", "sm")} w-full`}>
            {pending && <Loader2 className="size-3.5 animate-spin" />} Save plan fields
          </button>
        )}
      </div>
    </Card>
  );
}
