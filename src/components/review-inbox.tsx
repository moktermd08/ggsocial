"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ExternalLink, Loader2, RotateCcw, Square, Undo2 } from "lucide-react";
import { Button, buttonClass } from "./ui";
import { decideStepAction, setAutomationAction, setStepReviewAction } from "@/server/actions/workflows";
import { formatUsd } from "@/lib/ai-cost";
import type { PauseKind } from "@/lib/workflows/meta";

const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none";

/**
 * The buttons on one paused step. A post waiting for review is approved on
 * its own page, where the playbook checklist is; everything else is decided
 * here in one click.
 */
export function PauseControls({ stepId, kind, after, sendBack, href, reviewOnPage, canDecide }: {
  stepId: string;
  kind: PauseKind;
  /** The step's work is done: approving moves on. Otherwise approving re-runs it. */
  after: boolean;
  sendBack: boolean;
  href?: string;
  /** Approve on the linked page rather than here. */
  reviewOnPage: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<"send_back" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const act = (decision: "approve" | "send_back" | "reject" | "done") => {
    setMessage(null);
    setBusy(decision);
    start(async () => {
      try {
        const r = await decideStepAction({ stepId, decision, note: note || null });
        if (!r.ok) { setMessage({ ok: false, text: r.error }); return; }
        setMessage({ ok: true, text: r.message });
        setNote("");
        setNoteFor(null);
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "Could not reach the server. Check your connection and try again." });
      } finally {
        setBusy(null);
      }
    });
  };
  const spin = (d: string) => (busy === d ? <Loader2 className="size-3.5 animate-spin" /> : null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {href && (
          <Link href={href} className={buttonClass(reviewOnPage ? "primary" : "subtle", "sm")}>
            <ExternalLink className="size-3.5" /> {reviewOnPage ? "Review and approve" : "Open"}
          </Link>
        )}
        {canDecide && kind === "human" && (
          <Button size="sm" variant="primary" disabled={pending} onClick={() => act("done")} title="The run looks again to see whether it can carry on.">
            {spin("done") ?? <Check className="size-3.5" />} Done — check again
          </Button>
        )}
        {canDecide && kind !== "human" && !reviewOnPage && (
          <Button size="sm" variant="primary" disabled={pending} onClick={() => act("approve")}>
            {spin("approve") ?? (after ? <Check className="size-3.5" /> : <RotateCcw className="size-3.5" />)} {after ? "Approve" : "Retry"}
          </Button>
        )}
        {canDecide && kind !== "human" && sendBack && (
          <Button size="sm" disabled={pending} onClick={() => setNoteFor(noteFor === "send_back" ? null : "send_back")}>
            <Undo2 className="size-3.5" /> Send back
          </Button>
        )}
        {canDecide && kind !== "human" && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setNoteFor(noteFor === "reject" ? null : "reject")}>
            <Square className="size-3.5" /> Stop
          </Button>
        )}
      </div>
      {noteFor && (
        <div className="space-y-2">
          <textarea
            className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={noteFor === "send_back" ? "What should the agent change?" : "Why stop it? (optional)"}
          />
          <div className="flex gap-2">
            <Button size="sm" variant={noteFor === "reject" ? "danger" : "primary"} disabled={pending || (noteFor === "send_back" && !note.trim())} onClick={() => act(noteFor)}>
              {spin(noteFor)} {noteFor === "send_back" ? "Send back with this note" : "Stop this run"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setNoteFor(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {message && <p className={`text-xs ${message.ok ? "text-muted" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}

/**
 * The review switch on one step for one brand. Switching off asks why, and
 * only the owner can; the reason stays next to the switch and in the log.
 */
export function StepReviewSwitch({ brandId, code, stepKey, review, reason, canTurnOff, canTurnOn }: {
  brandId: string; code: string; stepKey: string; review: boolean; reason: string | null;
  canTurnOff: boolean; canTurnOn: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const allowed = review ? canTurnOff : canTurnOn;

  const save = (next: boolean) => {
    setError(null);
    start(async () => {
      try {
        const r = await setStepReviewAction({ brandId, code, stepKey, review: next, reason: next ? null : why });
        if (!r.ok) { setError(r.error); return; }
        setAsking(false);
        setWhy("");
        router.refresh();
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button" role="switch" aria-checked={review} aria-label={`Human review ${review ? "on" : "off"}`}
          disabled={!allowed || pending}
          onClick={() => (review ? setAsking((a) => !a) : save(true))}
          title={allowed ? undefined : review ? "Only the brand's owner can switch review off." : "You need approver access or above."}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${review ? "bg-accent" : "bg-border"}`}
        >
          <span className={`absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all ${review ? "left-[18px]" : "left-0.5"}`} />
        </button>
        <span className="text-xs text-muted">{review ? "A person reviews" : "Runs without review"}</span>
        {pending && <Loader2 className="size-3.5 animate-spin text-muted" />}
      </div>
      {!review && reason && <p className="text-[11px] text-muted">Why: {reason}</p>}
      {asking && (
        <div className="space-y-2">
          <textarea className={input} rows={2} value={why} onChange={(e) => setWhy(e.target.value)}
            placeholder="Why can the agent do this step unreviewed? Safety stops still apply." />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={pending || !why.trim()} onClick={() => save(false)}>Switch review off</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * A brand's daily AI budget, with today's spend, and the reviewer score its
 * agents' work must reach to go on without a person. Owner-set.
 */
export function AutomationSettings({ brandId, budget, threshold, spent, canEdit }: {
  brandId: string; budget: number; threshold: number; spent: number; canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [b, setB] = useState(String(budget));
  const [t, setT] = useState(String(threshold));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const share = budget > 0 ? Math.min(1, spent / budget) : 1;
  const dirty = Number(b) !== budget || Number(t) !== threshold;

  const save = () => {
    setMessage(null);
    start(async () => {
      try {
        const r = await setAutomationAction({ brandId, aiDailyBudget: Number(b), reviewThreshold: Number(t) });
        if (!r.ok) { setMessage({ ok: false, text: r.error }); return; }
        setMessage({ ok: true, text: "Saved. Agents follow it from their next run." });
        router.refresh();
      } catch {
        setMessage({ ok: false, text: "Could not reach the server. Check your connection and try again." });
      }
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border border-border px-3 py-2.5 md:grid-cols-[minmax(0,1.2fr)_auto_auto_auto] md:items-end">
      <div className="min-w-0">
        <p className="text-xs text-muted">
          AI spend today: <span className="font-medium text-text">{formatUsd(spent)}</span> of {formatUsd(budget)}
          {share >= 1 && <span className="text-danger"> — spent; agents wait until tomorrow</span>}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of today's AI budget spent">
          <div className={`h-full ${share >= 1 ? "bg-danger" : share >= 0.8 ? "bg-warn" : "bg-accent"}`} style={{ width: `${share * 100}%` }} />
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] text-muted">Daily budget ($)</span>
        <input type="number" min={0} max={1000} step={0.5} className={`${input} w-28`} value={b} disabled={!canEdit || pending} onChange={(e) => setB(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] text-muted">Reviewer pass mark</span>
        <input type="number" min={0} max={100} step={5} className={`${input} w-24`} value={t} disabled={!canEdit || pending} onChange={(e) => setT(e.target.value)} />
      </label>
      {canEdit ? (
        <Button size="sm" variant="primary" disabled={pending || !dirty} onClick={save}>{pending && <Loader2 className="size-3.5 animate-spin" />} Save</Button>
      ) : <span className="text-[11px] text-muted md:pb-2">Owner only</span>}
      {message && <p className={`text-xs md:col-span-4 ${message.ok ? "text-muted" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
