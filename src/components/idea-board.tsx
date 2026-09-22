"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronRight, Loader2, Plus, Search, Sparkles, Split } from "lucide-react";
import { Card, Field, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { STATUS_META, inZone } from "@/lib/format";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import { IDEA_STATUSES, type IdeaStatus } from "@/lib/db/idea-status";
import {
  saveIdeaAction, fanOutIdeaAction, saveIdeaVersionAction, resolveIdeaFieldAction, resetIdeaVersionAction, type IdeaInput,
} from "@/server/actions/ideas";
import { IDEA_FIELD_LABELS, ideaValues, readableIdeaValue, type IdeaField, type IdeaValues } from "@/lib/ideas";
import { LabelRow, MasterTag } from "./master-panels";
import { draftPostAction, draftingStatusAction } from "@/server/actions/drafting";
import type { IdeaBoardRow } from "@/server/queries";

const IDEA_STATUS_META: Record<IdeaStatus, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#8b8b96" },
  planned: { label: "Planned", color: "#0f766e" },
  drafting: { label: "Drafting", color: "#b45309" },
  scheduled: { label: "Scheduled", color: "#4f46e5" },
  published: { label: "Published", color: "#15803d" },
  parked: { label: "Parked", color: "#6b7280" },
};

/** Fields the grid edits in place. Everything else is derived from the posts. */
type Draft = Pick<IdeaBoardRow, "status" | "postType" | "tone" | "needsMedia" | "targetImpressions" | "keyLearning" | "series" | "notes" | "title">;

function draftOf(row: IdeaBoardRow): Draft {
  return {
    status: row.status, postType: row.postType, tone: row.tone, needsMedia: row.needsMedia,
    targetImpressions: row.targetImpressions, keyLearning: row.keyLearning, series: row.series,
    notes: row.notes, title: row.title,
  };
}

/**
 * The content plan as a grid: one row per idea, one column per brand.
 *
 * Only the left-hand fields are stored on the idea. Every lane cell — status,
 * date, channels, impressions — is read back from the post that idea spawned,
 * so the plan cannot drift from what actually shipped.
 */
export function IdeaBoard({ rows, scopeLabel, brandScope = null }: {
  rows: IdeaBoardRow[];
  scopeLabel: string | null;
  /** One brand in view: rows show that brand's version of each idea, and edits go to it. */
  brandScope?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);

  const [adding, setAdding] = useState("");
  const [query, setQuery] = useState("");
  const [pillar, setPillar] = useState("all");
  const [status, setStatus] = useState("all");
  const [onlyUnstarted, setOnlyUnstarted] = useState(false);

  const pillars = useMemo(
    () => [...new Set(rows.map((r) => r.pillar).filter(Boolean))] as string[],
    [rows],
  );

  const current = (row: IdeaBoardRow): Draft => drafts[row.id] ?? draftOf(row);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (pillar !== "all" && r.pillar !== pillar) return false;
      if (status !== "all" && (drafts[r.id] ?? r).status !== status) return false;
      if (onlyUnstarted && r.liveLanes > 0) return false;
      if (!q) return true;
      return [r.problem, r.action, r.outcome, r.title, r.pillar, r.series]
        .filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, query, pillar, status, onlyUnstarted, drafts]);

  const lanes = rows[0]?.lanes ?? [];
  const selectedRows = visible.filter((r) => selected.has(r.id));
  const draftsToCreate = selectedRows.reduce((n, r) => n + r.lanes.filter((l) => !l.post && !l.version?.skipped).length, 0);

  function patch(row: IdeaBoardRow, change: Partial<Draft>) {
    const next = { ...current(row), ...change };
    setDrafts((d) => ({ ...d, [row.id]: next }));
    setError(null);
    startTransition(async () => {
      try {
        const input: IdeaInput = {
          ideaId: row.id,
          problem: row.problem, action: row.action, outcome: row.outcome, pillar: row.pillar,
          hashtags: row.hashtags,
          ...next,
        };
        await saveIdeaAction(input);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that change.");
        setDrafts((d) => ({ ...d, [row.id]: draftOf(row) }));
      }
    });
  }

  /** Runs a brand-version change, then re-reads the board. */
  function runVersion(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not save that change."); }
    });
  }

  /** One line in, one idea out: "problem → action → outcome", beats optional. */
  function addIdea() {
    const line = adding.trim();
    if (!line) return;
    const [problem, action, outcome] = line.split("→").map((part) => part.trim());
    setError(null);
    startTransition(async () => {
      try {
        await saveIdeaAction({ problem, action: action ?? null, outcome: outcome ?? null });
        setAdding("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add that idea.");
      }
    });
  }

  /**
   * Creates the missing lane posts, and optionally has Claude write each one.
   *
   * Drafting runs from the browser, one request per post, a few at a time: each
   * call takes tens of seconds, and a single request drafting a dozen ideas
   * would blow straight through the 120s proxy timeout on the live server.
   * Only posts created by this click are drafted, so nothing a person has
   * already edited is rewritten.
   */
  function fanOut(ideaIds: string[], withClaude = false) {
    setError(null);
    startTransition(async () => {
      try {
        if (withClaude) {
          const status = await draftingStatusAction();
          if (!status.ok) { setError(status.error); return; }
        }
        const created: string[] = [];
        for (const id of ideaIds) {
          const res = await fanOutIdeaAction(id, lanes.map((l) => l.brand.id));
          created.push(...res.createdPostIds);
        }
        setSelected(new Set());

        if (withClaude && created.length > 0) {
          const failed: string[] = [];
          let done = 0;
          setProgress({ done, total: created.length, failed });
          const queue = [...created];
          const worker = async () => {
            for (let postId = queue.shift(); postId; postId = queue.shift()) {
              const res = await draftPostAction(postId);
              if (!res.ok) failed.push(res.error);
              done += 1;
              setProgress({ done, total: created.length, failed: [...failed] });
            }
          };
          await Promise.all([worker(), worker(), worker()]);
          // A missing key fails every call identically; say it once.
          if (failed.length) setError([...new Set(failed)].join(" "));
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the drafts.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => { e.preventDefault(); addIdea(); }}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-2"
      >
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add an idea — problem → what you do about it → the outcome"
          className="!w-auto flex-1 !py-1.5 !text-sm"
        />
        <button type="submit" disabled={pending || !adding.trim()} className={buttonClass("primary", "sm")}>
          <Plus className="size-3.5" /> Add idea
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the plan — security, migration, hiring…"
            className="!w-full !py-1.5 !pl-8 !text-sm"
          />
        </label>
        <select value={pillar} onChange={(e) => setPillar(e.target.value)} className="!w-auto !py-1.5 !text-sm">
          <option value="all">All pillars</option>
          {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto !py-1.5 !text-sm">
          <option value="all">Any status</option>
          {IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_STATUS_META[s].label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setOnlyUnstarted((v) => !v)}
          className={buttonClass(onlyUnstarted ? "primary" : "subtle", "sm")}
        >
          Not started yet
        </button>
        {pending && <Loader2 className="size-4 animate-spin text-muted" />}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      {progress && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
          {progress.done < progress.total
            ? <Loader2 className="size-3.5 animate-spin text-accent" />
            : <Sparkles className="size-3.5 text-accent" />}
          {progress.done < progress.total
            ? `Claude is writing ${progress.done + 1} of ${progress.total}…`
            : `Claude wrote ${progress.total - progress.failed.length} of ${progress.total} drafts. Open a lane to review.`}
          {progress.done >= progress.total && (
            <button type="button" onClick={() => setProgress(null)} className="ml-auto text-muted underline">Dismiss</button>
          )}
        </p>
      )}

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium">{selectedRows.length} idea{selectedRows.length === 1 ? "" : "s"} selected</span>
          <button
            type="button"
            disabled={pending || draftsToCreate === 0}
            onClick={() => fanOut(selectedRows.map((r) => r.id))}
            className={buttonClass("primary", "sm")}
          >
            <Split className="size-3.5" />
            Fan out — {draftsToCreate} draft{draftsToCreate === 1 ? "" : "s"}
          </button>
          <button
            type="button"
            disabled={pending || draftsToCreate === 0}
            onClick={() => fanOut(selectedRows.map((r) => r.id), true)}
            className={buttonClass("subtle", "sm")}
            title="Creates the drafts, then has Claude write each one in its brand's voice"
          >
            <Sparkles className="size-3.5" /> Fan out + write with Claude
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className={buttonClass("ghost", "sm")}>Clear</button>
        </div>
      )}

      {lanes.length === 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          No brands in view, so there is nothing to fan out into. Add a brand, or widen the brand switcher.
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[72rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="w-8 px-2 py-2 font-semibold"></th>
              <th className="w-[28rem] px-2 py-2 font-semibold">Idea</th>
              <th className="w-32 px-2 py-2 font-semibold">Status</th>
              <th className="w-24 px-2 py-2 font-semibold">Type</th>
              <th className="w-24 px-2 py-2 font-semibold">Tone</th>
              {lanes.map((l) => (
                <th key={l.brand.id} className="w-32 px-2 py-2 font-semibold" style={{ color: tintedInk(l.brand.color) }}>
                  {l.brand.name}
                </th>
              ))}
              <th className="w-20 px-2 py-2 text-right font-semibold" title="Impressions you are aiming at, per post">Target</th>
              <th className="w-20 px-2 py-2 text-right font-semibold" title="Impressions reported across every lane">Reached</th>
              <th className="w-16 px-2 py-2 text-right font-semibold">Comments</th>
              <th className="w-16 px-2 py-2 text-right font-semibold" title="Clicks on every tracked link these posts carried">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const d = current(row);
              const isOpen = open === row.id;
              return (
                <IdeaRow
                  key={row.id}
                  row={row}
                  draft={d}
                  open={isOpen}
                  pending={pending}
                  checked={selected.has(row.id)}
                  onCheck={(on) => setSelected((s) => {
                    const next = new Set(s);
                    if (on) next.add(row.id); else next.delete(row.id);
                    return next;
                  })}
                  onToggle={() => setOpen(isOpen ? null : row.id)}
                  onPatch={(change) => patch(row, change)}
                  onFanOut={(withClaude) => fanOut([row.id], withClaude)}
                  brandScope={brandScope}
                  onVersion={(change) => runVersion(() => saveIdeaVersionAction({ ideaId: row.id, brandId: brandScope!.id, ...change }))}
                  onResolve={(versionId, field, choice) => runVersion(() => resolveIdeaFieldAction(versionId, field, choice))}
                  onReset={(versionId) => runVersion(() => resetIdeaVersionAction(versionId))}
                />
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            The plan sits above your brands: write an idea once, then fan it out so each brand tells it in its own
            voice. Add one above, or load a whole plan from a file with <code>npm run seed:ideas</code>.
          </p>
        )}

        {rows.length > 0 && visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Nothing matches those filters.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => { setQuery(""); setPillar("all"); setStatus("all"); setOnlyUnstarted(false); }}
            >
              Clear them
            </button>
          </p>
        )}
      </Card>

      <p className="text-[11px] text-muted">
        Lane cells read straight from the posts each idea spawned — status, dates, channels and impressions are never
        typed twice. {scopeLabel ? `Showing the ${scopeLabel} lane only; switch to all brands to see the rest.` : ""}
      </p>
    </div>
  );
}

type VersionChange = { values?: Partial<IdeaValues>; angle?: string | null; notes?: string | null; skipped?: boolean };

function IdeaRow({
  row, draft, open, pending, checked, onCheck, onToggle, onPatch, onFanOut,
  brandScope, onVersion, onResolve, onReset,
}: {
  row: IdeaBoardRow;
  draft: Draft;
  open: boolean;
  pending: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onToggle: () => void;
  onPatch: (change: Partial<Draft>) => void;
  onFanOut: (withClaude: boolean) => void;
  brandScope: { id: string; name: string } | null;
  onVersion: (change: VersionChange) => void;
  onResolve: (versionId: string, field: IdeaField, choice: "accept" | "keep") => void;
  onReset: (versionId: string) => void;
}) {
  const meta = IDEA_STATUS_META[draft.status];
  const missingLanes = row.lanes.filter((l) => !l.post && !l.version?.skipped).length;

  // With one brand in view, the row is that brand's version of the idea.
  const version = brandScope ? row.lanes[0]?.version ?? null : null;
  const shown = version?.values ?? null;
  const told = {
    title: shown ? shown.title : draft.title,
    problem: shown ? shown.problem : row.problem,
    action: shown ? shown.action || null : row.action,
    outcome: shown ? shown.outcome || null : row.outcome,
    postType: shown ? shown.postType || null : draft.postType,
    tone: shown ? shown.tone || null : draft.tone,
    targetImpressions: shown ? (shown.targetImpressions === "" ? null : Number(shown.targetImpressions)) : draft.targetImpressions,
  };
  /** In brand view these cells edit the brand's version; otherwise the idea itself. */
  const commit = (field: "postType" | "tone" | "targetImpressions", value: string) => {
    if (brandScope) {
      onVersion({ values: { [field]: field === "targetImpressions" ? value.replace(/\D/g, "") : value } });
    } else if (field === "targetImpressions") {
      onPatch({ targetImpressions: value.trim() === "" ? null : Number(value.replace(/\D/g, "")) || null });
    } else {
      onPatch({ [field]: value || null });
    }
  };

  return (
    <>
      <tr className="border-b border-border align-top hover:bg-surface-2">
        <td className="px-2 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            aria-label={`Select "${row.problem}"`}
            className="!w-auto"
          />
        </td>

        <td className="px-2 py-2">
          <button type="button" onClick={onToggle} className="flex w-full items-start gap-1.5 text-left">
            <ChevronRight className={`mt-0.5 size-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="min-w-0">
              <span className="block truncate font-medium leading-tight">
                <span className="mr-1.5 tabular-nums text-muted">{row.sequence}</span>
                {told.title || told.problem}
              </span>
              {told.action && (
                <span className="mt-0.5 line-clamp-1 block text-xs leading-tight text-muted">
                  {told.action}{told.outcome ? ` → ${told.outcome}` : ""}
                </span>
              )}
              <span className="mt-1 flex flex-wrap items-center gap-1">
                {version?.skipped && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">Skipped by {brandScope?.name}</span>
                )}
                {version && version.customised.length > 0 && (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">Adapted for {brandScope?.name}</span>
                )}
                {version && version.pending.length > 0 && (
                  <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">Idea changed</span>
                )}
                {row.pillar && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{row.pillar}</span>
                )}
                {draft.series && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">Series: {draft.series}</span>
                )}
                {draft.needsMedia && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">Needs media</span>
                )}
              </span>
            </span>
          </button>
        </td>

        <td className="px-2 py-2">
          <select
            value={draft.status}
            onChange={(e) => onPatch({ status: e.target.value as IdeaStatus })}
            className="!w-full !px-1.5 !py-1 !text-xs"
            style={{ borderColor: tintedBorder(meta.color), background: tintedSurface(meta.color), color: tintedInk(meta.color) }}
          >
            {IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_STATUS_META[s].label}</option>)}
          </select>
        </td>

        <td className="px-2 py-2">
          <CellInput value={told.postType ?? ""} placeholder="—" onCommit={(v) => commit("postType", v)} />
        </td>
        <td className="px-2 py-2">
          <CellInput value={told.tone ?? ""} placeholder="—" onCommit={(v) => commit("tone", v)} />
        </td>

        {row.lanes.map((lane) => (
          <td key={lane.brand.id} className="px-2 py-2">
            <LaneCell lane={lane} />
          </td>
        ))}

        <td className="px-2 py-2 text-right">
          <CellInput
            value={told.targetImpressions == null ? "" : String(told.targetImpressions)}
            placeholder="—"
            align="right"
            inputMode="numeric"
            onCommit={(v) => commit("targetImpressions", v)}
          />
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {row.reachedImpressions > 0 ? row.reachedImpressions.toLocaleString() : <span className="text-muted">—</span>}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {row.totalComments > 0 ? row.totalComments.toLocaleString() : <span className="text-muted">—</span>}
        </td>
        <td className="px-2 py-2 text-right font-medium tabular-nums">
          {row.clicks > 0 ? row.clicks.toLocaleString() : <span className="font-normal text-muted">—</span>}
        </td>
      </tr>

      {open && brandScope && (
        <tr className="border-b border-border bg-surface-2">
          <td />
          <td colSpan={99} className="px-2 py-3">
            <BrandVersionEditor
              key={version ? JSON.stringify(version) : "none"}
              brandName={brandScope.name}
              master={ideaValues({ ...row, title: draft.title })}
              version={version}
              pending={pending}
              onSave={onVersion}
              onResolve={onResolve}
              onReset={onReset}
            />
          </td>
        </tr>
      )}

      {open && !brandScope && (
        <tr className="border-b border-border bg-surface-2">
          <td />
          <td colSpan={99} className="px-2 py-3">
            <div className="grid gap-3 pr-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Working title" hint="Blank uses the problem line.">
                <input
                  defaultValue={draft.title}
                  onBlur={(e) => e.target.value !== draft.title && onPatch({ title: e.target.value })}
                  className="!py-1 !text-sm"
                />
              </Field>
              <Field label="Series" hint="Blank means a one-off.">
                <input
                  defaultValue={draft.series ?? ""}
                  onBlur={(e) => e.target.value !== (draft.series ?? "") && onPatch({ series: e.target.value || null })}
                  className="!py-1 !text-sm"
                />
              </Field>
              <Field label="Key learning" hint="What this idea taught you, after it ran.">
                <input
                  defaultValue={draft.keyLearning ?? ""}
                  onBlur={(e) => e.target.value !== (draft.keyLearning ?? "") && onPatch({ keyLearning: e.target.value || null })}
                  className="!py-1 !text-sm"
                />
              </Field>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs font-medium text-muted">
                  <input
                    type="checkbox"
                    checked={draft.needsMedia}
                    onChange={(e) => onPatch({ needsMedia: e.target.checked })}
                    className="!w-auto"
                  />
                  Needs media
                </label>
                <button
                  type="button"
                  onClick={() => onFanOut(true)}
                  disabled={pending || missingLanes === 0}
                  className={buttonClass("primary", "sm")}
                  title={missingLanes === 0 ? "Every brand already has a draft for this idea" : "Creates the drafts, then Claude writes each in its brand's voice"}
                >
                  <Sparkles className="size-3.5" />
                  {missingLanes === 0 ? "All lanes drafted" : `Write ${missingLanes} with Claude`}
                </button>
                {missingLanes > 0 && (
                  <button
                    type="button"
                    onClick={() => onFanOut(false)}
                    disabled={pending}
                    className={buttonClass("subtle", "sm")}
                  >
                    <Split className="size-3.5" /> Empty drafts only
                  </button>
                )}
              </div>
              <Field label="Notes">
                <textarea
                  rows={2}
                  defaultValue={draft.notes ?? ""}
                  onBlur={(e) => e.target.value !== (draft.notes ?? "") && onPatch({ notes: e.target.value || null })}
                  className="!py-1 !text-sm"
                />
              </Field>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** A lane: this brand's post for this idea, or the button that creates it. */
function LaneCell({ lane }: { lane: IdeaBoardRow["lanes"][number] }) {
  const v = lane.version;
  const marker = v?.skipped ? (
    <span className="block text-[10px] font-medium text-muted">Skipped</span>
  ) : v && v.pending.length > 0 ? (
    <span className="block text-[10px] font-medium text-warn" title="The idea changed since this brand adapted it">Idea changed</span>
  ) : v && (v.customised.length > 0 || v.angle) ? (
    <span className="block text-[10px] font-medium text-accent" title="This brand has its own version of the idea">Adapted</span>
  ) : null;
  if (!lane.post) {
    return marker ?? <span className="text-xs text-muted">—</span>;
  }
  const meta = STATUS_META[lane.post.status];
  return (
    <Link href={`/posts/${lane.post.id}`} className="block space-y-1 rounded-md p-1 hover:bg-surface">
      {marker}
      <span
        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
        style={{ borderColor: tintedBorder(meta.color), background: tintedSurface(meta.color), color: tintedInk(meta.color) }}
      >
        {meta.label}
      </span>
      {lane.post.scheduledAt && (
        <span className="block text-[10px] tabular-nums text-muted">
          {inZone(lane.post.scheduledAt, lane.brand.timezone)}
        </span>
      )}
      {lane.channels.length > 0 && (
        <span className="flex flex-wrap gap-0.5">
          {lane.channels.slice(0, 4).map((c) => <PlatformIcon key={c.id} platform={c.platform} size={13} />)}
        </span>
      )}
      {lane.impressions > 0 && (
        <span className="block text-[10px] tabular-nums text-muted">{lane.impressions.toLocaleString()} impr.</span>
      )}
    </Link>
  );
}

/**
 * A grid cell that looks like text until you click it. Saving happens on blur
 * so typing never fires a round-trip per keystroke.
 */
function CellInput({
  value, placeholder, onCommit, align = "left", inputMode,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  align?: "left" | "right";
  inputMode?: "numeric";
}) {
  return (
    <input
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      inputMode={inputMode}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      className={`!border-transparent !bg-transparent !px-1 !py-0.5 !text-xs hover:!border-border focus:!border-accent ${
        align === "right" ? "text-right" : ""
      }`}
    />
  );
}

/**
 * One brand's version of an idea. Every field starts as the idea's and is
 * marked "From master" until the brand changes it; the angle and notes are the
 * brand's alone. Fan-out and Claude write this brand's draft from what is here.
 */
function BrandVersionEditor({
  brandName, master, version, pending, onSave, onResolve, onReset,
}: {
  brandName: string;
  master: IdeaValues;
  version: IdeaBoardRow["lanes"][number]["version"];
  pending: boolean;
  onSave: (change: VersionChange) => void;
  onResolve: (versionId: string, field: IdeaField, choice: "accept" | "keep") => void;
  onReset: (versionId: string) => void;
}) {
  const start = version?.values ?? master;
  const [values, setValues] = useState<IdeaValues>(start);
  const [hashtags, setHashtags] = useState((JSON.parse(start.hashtags) as string[]).join(" "));
  const [angle, setAngle] = useState(version?.angle ?? "");
  const [notes, setNotes] = useState(version?.notes ?? "");

  const current: IdeaValues = {
    ...values,
    hashtags: JSON.stringify(hashtags.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`))),
  };
  const set = (f: IdeaField, v: string) => setValues((prev) => ({ ...prev, [f]: v }));
  const tag = (f: IdeaField) => (
    <MasterTag
      customised={current[f] !== master[f]}
      onReset={() => (f === "hashtags" ? setHashtags((JSON.parse(master.hashtags) as string[]).join(" ")) : set(f, master[f]))}
    />
  );
  const field = (f: IdeaField, opts: { rows?: number; numeric?: boolean } = {}) => (
    <Field label={<LabelRow text={IDEA_FIELD_LABELS[f]} tag={tag(f)} />}>
      {opts.rows ? (
        <textarea rows={opts.rows} value={values[f]} onChange={(e) => set(f, e.target.value)} className="!py-1 !text-sm" />
      ) : (
        <input
          value={values[f]}
          inputMode={opts.numeric ? "numeric" : undefined}
          onChange={(e) => set(f, opts.numeric ? e.target.value.replace(/\D/g, "") : e.target.value)}
          className="!py-1 !text-sm"
        />
      )}
    </Field>
  );

  const changed = (Object.keys(current) as IdeaField[]).filter((f) => current[f] !== start[f]);

  return (
    <div className="space-y-3 pr-4">
      <p className="text-xs text-muted">
        <span className="font-medium text-text">{brandName}&apos;s version.</span>{" "}
        {version
          ? "Fields marked “From master” still follow the idea; change one to make it this brand's own."
          : "This brand tells the idea exactly as written. Change anything below to adapt it."}
        {" "}Fan-out and Claude write this brand&apos;s draft from what is here.
      </p>

      {version && version.pending.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5">
          <p className="text-xs font-medium text-warn">The idea has changed since {brandName} adapted it</p>
          {version.pending.map((f) => (
            <div key={f} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{IDEA_FIELD_LABELS[f]}:</span>
              <span className="min-w-0 flex-1 truncate text-muted">{readableIdeaValue(f, master[f]) || "(empty)"}</span>
              <button type="button" disabled={pending} onClick={() => onResolve(version.id, f, "accept")} className={buttonClass("primary", "sm")}>Use master</button>
              <button type="button" disabled={pending} onClick={() => onResolve(version.id, f, "keep")} className={buttonClass("subtle", "sm")}>Keep ours</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">{field("problem", { rows: 2 })}</div>
        <div className="sm:col-span-2">{field("title")}</div>
        <div className="sm:col-span-2">{field("action", { rows: 2 })}</div>
        <div className="sm:col-span-2">{field("outcome", { rows: 2 })}</div>
        {field("postType")}
        {field("tone")}
        {field("targetImpressions", { numeric: true })}
        <Field label={<LabelRow text={IDEA_FIELD_LABELS.hashtags} tag={tag("hashtags")} />}>
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} className="!py-1 !text-sm" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Angle for this brand" hint="How this brand tells it. Claude reads this when drafting.">
            <textarea rows={2} value={angle} onChange={(e) => setAngle(e.target.value)} className="!py-1 !text-sm"
              placeholder="Tell it as the agency that fixed it, not the tool." />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes for this brand">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="!py-1 !text-sm" />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || (changed.length === 0 && angle === (version?.angle ?? "") && notes === (version?.notes ?? ""))}
          onClick={() => onSave({
            values: Object.fromEntries(changed.map((f) => [f, current[f]])) as Partial<IdeaValues>,
            angle, notes,
          })}
          className={buttonClass("primary", "sm")}
        >
          Save {brandName}&apos;s version
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={version?.skipped ?? false}
            disabled={pending}
            onChange={(e) => onSave({ skipped: e.target.checked })}
            className="!w-auto"
          />
          {brandName} skips this idea
        </label>
        {version && (
          <button
            type="button"
            disabled={pending}
            onClick={() => { if (confirm(`Drop ${brandName}'s version and tell the idea exactly as written?`)) onReset(version.id); }}
            className={buttonClass("ghost", "sm")}
          >
            Reset to master
          </button>
        )}
      </div>
    </div>
  );
}
