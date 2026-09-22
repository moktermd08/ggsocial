"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bot, Check, ChevronDown, Circle, CircleCheck, CircleDashed, CircleSlash, CircleX, Loader2, Search,
  ShieldCheck, ShieldX, Timer, Undo2, UserRound,
} from "lucide-react";
import { Badge, Button, Card, Field } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { relativeTime } from "@/lib/format";
import { tintedInk, tintedSurface } from "@/lib/color";
import {
  ACTIVITY_CATEGORIES, AGENT_SUGGESTIONS, CATEGORY_META, CELL_STATUS_META, PERFORMER_META, PROOF_META, targetText,
  type ActivityCategory, type ActorKind, type CellStatus, type CheckStatus, type LeadImpact, type Performer,
  type ProofKind, type ReviewStatus,
} from "@/lib/activities/meta";
import {
  clearChecksAction, reviewChecksAction, setChecksAction, type CheckTarget,
} from "@/server/actions/activities";

export type ChecklistBrand = { id: string; name: string; color: string; canEdit: boolean; canReview: boolean };

export type ChecklistCellView = {
  brandId: string;
  applies: boolean;
  target: number;
  status: CellStatus;
  count: number | null;
  proofUrl: string | null;
  notes: string | null;
  doneByKind: ActorKind | null;
  doneByName: string | null;
  /** The signed-in person who did it, or who logged an agent's work. */
  doneByUser: string | null;
  source: "app" | "api" | null;
  doneAt: string | null;
  review: ReviewStatus | null;
  reviewNote: string | null;
  reviewerKind: ActorKind | null;
  reviewerName: string | null;
  reviewedAt: string | null;
};

export type ChecklistRowView = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: ActivityCategory;
  platforms: string[];
  unit: string;
  proof: ProofKind;
  performer: Performer;
  leadImpact: LeadImpact;
  estMinutes: number;
  cells: ChecklistCellView[];
};

const STATUS_ICON: Record<CellStatus, typeof Circle> = {
  open: Circle, done: CircleCheck, partial: CircleDashed, skipped: CircleSlash, missed: CircleX,
};

type Lens = "all" | "todo" | "review" | "redo";

/**
 * One period's checklist across every brand in view: activities down the side,
 * brands across the top. A cell is one brand's tick for one activity.
 *
 * Built for one person running several brands: select rows, pick the brands,
 * and mark them in one go — or click a single cell to tick one brand alone.
 */
export function ActivityChecklist({
  brands, rows, date, phase,
}: {
  brands: ChecklistBrand[];
  rows: ChecklistRowView[];
  /** Any date in the period being shown — what every action is recorded against. */
  date: string;
  phase: "past" | "current" | "future";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ActivityCategory>("all");
  const [lens, setLens] = useState<Lens>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const editable = brands.filter((b) => b.canEdit);
  const [bulkBrands, setBulkBrands] = useState<Set<string>>(() => new Set(editable.map((b) => b.id)));
  const [actorKind, setActorKind] = useState<ActorKind>("human");
  const [agentName, setAgentName] = useState("Claude");
  const by = actorKind === "ai" ? { kind: "ai" as const, name: agentName } : { kind: "human" as const };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      const live = r.cells.filter((c) => c.applies);
      if (lens === "todo" && !live.some((c) => c.status === "open" || c.status === "missed")) return false;
      if (lens === "review" && !live.some((c) => (c.status === "done" || c.status === "partial") && !c.review)) return false;
      if (lens === "redo" && !r.cells.some((c) => c.review === "rejected")) return false;
      if (!q) return true;
      return [r.code, r.title, r.description, ...r.platforms].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query, category, lens]);

  const groups = ACTIVITY_CATEGORIES
    .map((c) => ({ category: c, rows: visible.filter((r) => r.category === c) }))
    .filter((g) => g.rows.length > 0);

  function run(work: () => Promise<{ updated: number } | void>, message?: (n: number) => string) {
    setError(null);
    setFlash(null);
    startTransition(async () => {
      try {
        const res = await work();
        if (message && res) setFlash(message(res.updated));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    });
  }

  /** Every (row, brand) pair in the selection that is on the plan and that we may touch. */
  function selectionTargets(filter: (c: ChecklistCellView) => boolean = () => true): CheckTarget[] {
    return rows
      .filter((r) => selected.has(r.id))
      .flatMap((r) => r.cells
        .filter((c) => c.applies && bulkBrands.has(c.brandId) && filter(c))
        .map((c) => ({ brandId: c.brandId, templateId: r.id })));
  }

  function bulkSet(status: CheckStatus) {
    const targets = selectionTargets();
    run(() => setChecksAction({ targets, date, status, by }), (n) => `${n} marked ${CELL_STATUS_META[status].label.toLowerCase()}.`);
  }

  function toggleCell(row: ChecklistRowView, cell: ChecklistCellView) {
    const target = [{ brandId: cell.brandId, templateId: row.id }];
    if (cell.status === "open" || cell.status === "missed") run(() => setChecksAction({ targets: target, date, status: "done", by }));
    else run(() => clearChecksAction({ targets: target, date }));
  }

  function allBrandsDone(row: ChecklistRowView) {
    const targets = row.cells
      .filter((c) => c.applies && (c.status === "open" || c.status === "missed") && editable.some((b) => b.id === c.brandId))
      .map((c) => ({ brandId: c.brandId, templateId: row.id }));
    if (targets.length) run(() => setChecksAction({ targets, date, status: "done", by }), (n) => `${row.code} done for ${n} brand${n === 1 ? "" : "s"}.`);
  }

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const multi = brands.length > 1;

  return (
    <div className="space-y-3">
      {phase !== "current" && (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          {phase === "past"
            ? "This period is over. Anything not recorded shows as missed — you can still record late work or a skip with a reason."
            : "This period has not started yet. You can plan ahead, but ticks are recorded against this future period."}
        </p>
      )}

      {/* ----------------------------------------------------------- filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activities, codes or platforms…"
            className="!w-full !py-1.5 !pl-8 !text-sm"
          />
        </label>
        <div className="flex rounded-lg border border-border p-0.5">
          {([["all", "All"], ["todo", "To do"], ["review", "Needs review"], ["redo", "Redo"]] as const).map(([l, label]) => (
            <button
              key={l}
              type="button"
              onClick={() => setLens(l)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${lens === l ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="!w-auto !py-1.5 !text-sm" aria-label="Category">
          <option value="all">All categories</option>
          {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
        </select>
      </div>

      {/* -------------------------------------------------- who is recording */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Record work as done by</span>
        <div className="flex rounded-lg border border-border p-0.5">
          <button type="button" onClick={() => setActorKind("human")}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${actorKind === "human" ? "bg-accent text-accent-fg" : "hover:bg-surface-2"}`}>
            <UserRound className="size-3.5" /> Me
          </button>
          <button type="button" onClick={() => setActorKind("ai")}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${actorKind === "ai" ? "bg-accent text-accent-fg" : "hover:bg-surface-2"}`}>
            <Bot className="size-3.5" /> An AI agent
          </button>
        </div>
        {actorKind === "ai" && (
          <>
            <input list="agent-names" value={agentName} onChange={(e) => setAgentName(e.target.value)} className="!w-36 !py-1 !text-xs" aria-label="Agent name" />
            <datalist id="agent-names">{AGENT_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
          </>
        )}
      </div>

      {/* ------------------------------------------------------ bulk actions */}
      {selected.size > 0 && (
        <Card className="sticky top-14 z-10 flex flex-wrap items-center gap-2 px-3 py-2 shadow-sm md:top-2">
          <span className="text-xs font-medium">{selected.size} selected</span>
          {multi && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted">for</span>
              {editable.map((b) => {
                const on = bulkBrands.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBulkBrands((s) => { const n = new Set(s); if (on) n.delete(b.id); else n.add(b.id); return n; })}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${on ? "" : "border-border text-muted opacity-60"}`}
                    style={on ? { borderColor: b.color, background: tintedSurface(b.color), color: tintedInk(b.color) } : undefined}
                    aria-pressed={on}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => bulkSet("done")}><Check className="size-3.5" /> Done</Button>
            <Button size="sm" disabled={pending} onClick={() => bulkSet("partial")}>Partly</Button>
            <Button size="sm" disabled={pending} onClick={() => bulkSet("skipped")}>Skip</Button>
            <Button size="sm" disabled={pending} onClick={() => run(() => clearChecksAction({ targets: selectionTargets(), date }), (n) => `${n} reset.`)}>
              <Undo2 className="size-3.5" /> Reset
            </Button>
            <Button size="sm" disabled={pending} onClick={() => run(
              () => reviewChecksAction({ targets: selectionTargets((c) => c.status === "done" || c.status === "partial"), date, decision: "approved", by }),
              (n) => `${n} approved.`,
            )}>
              <ShieldCheck className="size-3.5" /> Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </Card>
      )}

      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {flash && <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{flash}</p>}

      {/* ------------------------------------------------------------- table */}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allVisibleSelected}
                  onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)))}
                  className="!w-auto"
                />
              </th>
              <th className="py-2 pr-3 font-medium">Activity</th>
              {brands.map((b) => (
                <th key={b.id} className="w-24 px-1 py-2 text-center font-medium">
                  <span className="inline-flex max-w-24 items-center gap-1 truncate" title={b.name}>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} />
                    <span className="truncate">{b.name}</span>
                  </span>
                </th>
              ))}
              {multi && <th className="w-20 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={brands.length + 3} className="px-4 py-10 text-center text-sm text-muted">Nothing matches — try another filter.</td></tr>
            )}
            {groups.map((g) => {
              const meta = CATEGORY_META[g.category];
              const live = g.rows.flatMap((r) => r.cells.filter((c) => c.applies && c.status !== "skipped"));
              const doneCount = live.filter((c) => c.status === "done").length;
              return (
                <Fragment key={g.category}>
                  <tr className="border-b border-border bg-surface-2/60">
                    <td colSpan={brands.length + 3} className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold" style={{ color: tintedInk(meta.color, 80) }}>
                        <span className="size-2 rounded-sm" style={{ background: meta.color }} />
                        {meta.label}
                        <span className="font-normal text-muted">{doneCount}/{live.length} done</span>
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((r) => {
                    const isOpen = open === r.id;
                    const todoHere = r.cells.some((c) => c.applies && (c.status === "open" || c.status === "missed") && editable.some((b) => b.id === c.brandId));
                    return (
                      <Fragment key={r.id}>
                        <tr className={`border-b border-border align-middle ${isOpen ? "bg-surface-2/40" : "hover:bg-surface-2/30"}`}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${r.title}`}
                              checked={selected.has(r.id)}
                              onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                              className="!w-auto"
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-start gap-2 text-left">
                              <span className="mt-0.5 shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{r.code}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium leading-snug text-text">{r.title}</span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                                  <span>{targetText(r.cells.find((c) => c.applies)?.target ?? 1, r.unit)}</span>
                                  <span className="inline-flex items-center gap-0.5"><Timer className="size-3" />{r.estMinutes}m</span>
                                  {r.performer !== "human" && (
                                    <span className="inline-flex items-center gap-0.5" title={PERFORMER_META[r.performer].hint}><Bot className="size-3" />{PERFORMER_META[r.performer].label}</span>
                                  )}
                                  {r.leadImpact === "high" && <span className="font-medium text-ok">High lead impact</span>}
                                  {r.platforms.length > 0 && (
                                    <span className="inline-flex items-center gap-0.5">
                                      {r.platforms.slice(0, 6).map((p) => <PlatformIcon key={p} platform={p} size={13} variant="glyph" />)}
                                      {r.platforms.length > 6 && <span>+{r.platforms.length - 6}</span>}
                                    </span>
                                  )}
                                </span>
                              </span>
                              <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </button>
                          </td>
                          {r.cells.map((c) => {
                            const brand = brands.find((b) => b.id === c.brandId)!;
                            return (
                              <td key={c.brandId} className="px-1 py-2 text-center">
                                <StatusCell cell={c} disabled={pending || !brand.canEdit} onClick={() => toggleCell(r, c)} brandName={brand.name} />
                              </td>
                            );
                          })}
                          {multi && (
                            <td className="px-2 py-2 text-right">
                              {todoHere && (
                                <Button size="sm" variant="ghost" disabled={pending} onClick={() => allBrandsDone(r)} title="Mark done for every brand where it is still to do" aria-label={`Mark ${r.code} done for all brands`}>
                                  <Check className="size-3.5" /> All
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border bg-surface-2/40">
                            <td />
                            <td colSpan={brands.length + (multi ? 2 : 1)} className="pb-4 pr-3">
                              <RowDetail row={r} brands={brands} date={date} by={by} pending={pending} run={run} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
      {pending && <p className="flex items-center gap-1.5 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Saving…</p>}
    </div>
  );
}

function StatusCell({ cell, disabled, onClick, brandName }: { cell: ChecklistCellView; disabled: boolean; onClick: () => void; brandName: string }) {
  if (!cell.applies && (cell.status === "open" || cell.status === "missed")) {
    return <span className="text-xs text-muted/60" title={`Not on ${brandName}'s plan`}>—</span>;
  }
  const meta = CELL_STATUS_META[cell.status];
  const Icon = STATUS_ICON[cell.status];
  const who = cell.doneByKind === "ai" ? `${cell.doneByName} (AI)` : cell.doneByUser ?? cell.doneByName;
  const title = [
    `${brandName}: ${meta.label}`,
    who && `by ${who}`,
    cell.review && `review: ${cell.review}`,
    disabled ? "" : cell.status === "open" || cell.status === "missed" ? "— click to mark done" : "— click to reset",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="relative inline-grid size-8 place-items-center rounded-lg transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
      style={{ color: cell.status === "open" ? "var(--muted)" : tintedInk(meta.color, 85) }}
    >
      <Icon className="size-5" strokeWidth={cell.status === "done" ? 2.4 : 1.8} />
      {cell.doneByKind === "ai" && <Bot className="absolute -bottom-0.5 -left-0.5 size-3 rounded-sm bg-surface text-muted" />}
      {cell.review === "approved" && <ShieldCheck className="absolute -right-0.5 -top-0.5 size-3.5 rounded-sm bg-surface text-ok" />}
      {cell.review === "rejected" && <ShieldX className="absolute -right-0.5 -top-0.5 size-3.5 rounded-sm bg-surface text-danger" />}
    </button>
  );
}

function RowDetail({
  row, brands, date, by, pending, run,
}: {
  row: ChecklistRowView;
  brands: ChecklistBrand[];
  date: string;
  by: { kind: ActorKind; name?: string };
  pending: boolean;
  run: (work: () => Promise<{ updated: number } | void>, message?: (n: number) => string) => void;
}) {
  return (
    <div className="space-y-3 pt-1">
      <p className="max-w-3xl text-sm text-text">{row.description}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge color={CATEGORY_META[row.category].color}>{CATEGORY_META[row.category].label}</Badge>
        <Badge>Proof: {PROOF_META[row.proof]}</Badge>
        <Badge>{PERFORMER_META[row.performer].label}</Badge>
        <Badge>Lead impact: {row.leadImpact}</Badge>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {row.cells.filter((c) => c.applies || c.status !== "open").map((c) => {
          const brand = brands.find((b) => b.id === c.brandId)!;
          return <CellEditor key={`${c.brandId}:${c.doneAt}:${c.reviewedAt}`} row={row} cell={c} brand={brand} date={date} by={by} pending={pending} run={run} />;
        })}
      </div>
    </div>
  );
}

function CellEditor({
  row, cell, brand, date, by, pending, run,
}: {
  row: ChecklistRowView;
  cell: ChecklistCellView;
  brand: ChecklistBrand;
  date: string;
  by: { kind: ActorKind; name?: string };
  pending: boolean;
  run: (work: () => Promise<{ updated: number } | void>, message?: (n: number) => string) => void;
}) {
  const [status, setStatus] = useState<CheckStatus>(cell.status === "partial" || cell.status === "skipped" ? cell.status : "done");
  const [count, setCount] = useState(cell.count?.toString() ?? "");
  const [proofUrl, setProofUrl] = useState(cell.proofUrl ?? "");
  const [notes, setNotes] = useState(cell.notes ?? "");
  const [reviewNote, setReviewNote] = useState("");
  const target = [{ brandId: cell.brandId, templateId: row.id }];
  const recorded = cell.status === "done" || cell.status === "partial" || cell.status === "skipped";
  const meta = CELL_STATUS_META[cell.status];
  const who = cell.doneByKind === "ai"
    ? cell.source === "api" ? `${cell.doneByName} (AI, via the API)` : `${cell.doneByName} (AI)${cell.doneByUser ? `, logged by ${cell.doneByUser}` : ""}`
    : cell.doneByUser ?? cell.doneByName;
  const reviewer = cell.reviewerKind === "ai" ? `${cell.reviewerName} (AI)` : cell.reviewerName;

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <span className="size-2 rounded-full" style={{ background: brand.color }} />{brand.name}
        </span>
        <Badge color={meta.color}>{meta.label}</Badge>
      </div>

      {recorded && (
        <p className="mb-2 text-[11px] text-muted">
          {who && <>By {who} · </>}{cell.doneAt && relativeTime(cell.doneAt)}
          {cell.count !== null && <> · {cell.count} done (target {targetText(cell.target, row.unit)})</>}
          {cell.proofUrl && <> · <a href={cell.proofUrl} target="_blank" rel="noreferrer" className="text-accent underline">proof</a></>}
          {cell.notes && <><br />“{cell.notes}”</>}
        </p>
      )}
      {cell.review && (
        <p className={`mb-2 rounded-md px-2 py-1 text-[11px] ${cell.review === "approved" ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>
          {cell.review === "approved" ? "Approved" : "Sent back"} by {reviewer}{cell.reviewedAt && ` · ${relativeTime(cell.reviewedAt)}`}
          {cell.reviewNote && <>: “{cell.reviewNote}”</>}
        </p>
      )}

      {brand.canEdit && (
        <div className="space-y-2">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as CheckStatus)} className="!py-1 !text-xs">
                <option value="done">Done</option>
                <option value="partial">Partly done</option>
                <option value="skipped">Skipped (N/A)</option>
              </select>
            </Field>
            <Field label={`How many (target ${cell.target})`}>
              <input type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} className="!py-1 !text-xs" />
            </Field>
          </div>
          <Field label="Proof link">
            <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://…" className="!py-1 !text-xs" />
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={status === "skipped" ? "Why it was skipped" : "What was done"} className="!py-1 !text-xs" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setChecksAction({
              targets: target, date, status, by,
              count: count === "" ? null : Number(count), proofUrl: proofUrl || null, notes: notes || null,
            }))}>
              Save
            </Button>
            {recorded && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => clearChecksAction({ targets: target, date }))}>
                <Undo2 className="size-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>
      )}

      {brand.canReview && (cell.status === "done" || cell.status === "partial") && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2">
          <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Review note (optional)" className="!py-1 !text-xs" aria-label="Review note" />
          <div className="flex gap-1.5">
            <Button size="sm" disabled={pending} onClick={() => run(() => reviewChecksAction({ targets: target, date, decision: "approved", note: reviewNote || null, by }))}>
              <ShieldCheck className="size-3.5" /> Approve
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => reviewChecksAction({ targets: target, date, decision: "rejected", note: reviewNote || null, by }))}>
              <ShieldX className="size-3.5" /> Send back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
