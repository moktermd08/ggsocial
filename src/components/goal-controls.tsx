"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Loader2, Pause, Play, RefreshCw, Undo2, X } from "lucide-react";
import { Button } from "./ui";
import type { GoalStatus } from "@/lib/goals/meta";
import {
  decideRevisionAction, handBackActivityAction, recalibrateGoalAction, setGoalStatusAction,
} from "@/server/actions/goals";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<unknown>, ok?: (r: unknown) => string | null) => {
    setMessage(null);
    start(async () => {
      try {
        const r = await fn();
        const text = ok?.(r);
        if (text) setMessage({ ok: true, text });
        router.refresh();
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  };
  return { pending, message, run };
}

function Note({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return <p className={`text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>;
}

/** Recalibrate now, and pause / resume / archive — the header actions on a goal. */
export function GoalControls({ goalId, status, canManage, canRecalibrate }: {
  goalId: string; status: GoalStatus; canManage: boolean; canRecalibrate: boolean;
}) {
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canRecalibrate && status === "active" && (
          <Button size="sm" disabled={pending} title="Learn from the latest results and re-plan now (the weekly job does this every Monday)"
            onClick={() => run(() => recalibrateGoalAction(goalId), (r) => {
              const res = r as { status: string; summary: string };
              return res.status === "proposed" ? "Big change — the new plan is waiting for approval below." : "Re-planned.";
            })}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Recalibrate now
          </Button>
        )}
        {canManage && status === "active" && (
          <Button size="sm" variant="ghost" disabled={pending} title="Stop steering the activity checklists; history is kept"
            onClick={() => run(() => setGoalStatusAction(goalId, "paused"))}><Pause className="size-3.5" /> Pause</Button>
        )}
        {canManage && status !== "active" && (
          <Button size="sm" disabled={pending} onClick={() => run(() => setGoalStatusAction(goalId, "active"))}><Play className="size-3.5" /> Resume</Button>
        )}
        {canManage && status !== "archived" && (
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => { if (confirm("Archive this goal? Its activity targets go back to the master list.")) run(() => setGoalStatusAction(goalId, "archived")); }}>
            <Archive className="size-3.5" /> Archive
          </Button>
        )}
      </div>
      <Note message={message} />
    </div>
  );
}

export function RevisionDecision({ revisionId, children }: { revisionId: string; children?: ReactNode }) {
  const { pending, message, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => decideRevisionAction(revisionId, true), () => "New plan in force.")}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve new plan
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => decideRevisionAction(revisionId, false), () => "Kept the current plan.")}>
        <X className="size-3.5" /> Keep current plan
      </Button>
      {children}
      <Note message={message} />
    </div>
  );
}

export function HandBackButton({ brandId, activityCode, goalId }: { brandId: string; activityCode: string; goalId: string }) {
  const { pending, message, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="ghost" disabled={pending} title="Drop the hand-set target so the goal's plan can set it"
        onClick={() => run(() => handBackActivityAction({ brandId, activityCode, goalId }))}>
        {pending ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />} Hand back
      </Button>
      <Note message={message} />
    </span>
  );
}
