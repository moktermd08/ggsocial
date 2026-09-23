"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive, ArchiveRestore, Bot, Check, CircleSlash, ListChecks, Pencil, Plus, RotateCcw, Trash2, User, X,
} from "lucide-react";
import { Badge, Button, Card, Field } from "./ui";
import { PlatformIcon } from "./platform-icon";
import type { ActionResult } from "@/lib/action-result";
import {
  ADJUST_SOURCE_META, ADJUST_STATUS_META, CHECK_AUDIENCES, CHECK_AUDIENCE_META, ENFORCE_LEVELS, ENFORCE_META,
  LIMIT_FIELDS, LIMIT_GROUPS, RULE_KINDS, RULE_KIND_META, adjustFieldLabel, newItemId,
  type AdjustSource, type AdjustStatus, type ChecklistItem, type EnforceLevel, type LimitKey, type RuleKind, type RuleLimits,
} from "@/lib/playbook/meta";
import { describeRule, readableValue, type EffectiveRule } from "@/lib/playbook/check";
import {
  adjustBrandRuleAction, archiveRuleAction, decideAdjustmentAction, saveRuleAction,
} from "@/server/actions/playbook";
import { relativeTime } from "@/lib/format";

export type MasterRuleView = {
  id: string; code: string; kind: RuleKind; name: string; description: string; instructions: string;
  platforms: string[]; activityCodes: string[]; enforce: EnforceLevel; limits: RuleLimits; checklist: ChecklistItem[];
  isCustom: boolean; archived: boolean;
};
export type PlaybookBrand = { id: string; name: string; color: string; canPropose: boolean; canApply: boolean };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(work: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    start(async () => {
      try {
        const res = await work();
        if (!res.ok) { setError(res.error); return; }
        after?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    });
  }
  return { run, pending, error, setError };
}

/* ================================================================== rules */

/**
 * The master rules, or one brand's version of them. On the master every field
 * edits the rule for all brands; on a brand only the limits it changes are
 * stored, and the rest keep following the master.
 */
export function PlaybookRules({
  rules, brands, effective, brandId, canEditMaster, platformOptions,
}: {
  rules: MasterRuleView[];
  brands: PlaybookBrand[];
  effective: Record<string, EffectiveRule[]>;
  /** null = the master. */
  brandId: string | null;
  canEditMaster: boolean;
  platformOptions: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const { run, pending, error } = useRun();
  const brand = brands.find((b) => b.id === brandId) ?? null;
  const mine = brandId ? effective[brandId] ?? [] : [];

  const shown = rules.filter((r) => showRetired || !r.archived);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-64 flex-1 text-sm text-muted">
          {brand
            ? <>What <span className="font-medium text-text">{brand.name}</span> works to. Changed values are marked; everything else follows the master.{!brand.canApply && " Your changes go to the daily review for an approver."}</>
            : "The master rules every brand starts from. A change here reaches every brand that has not set its own value."}
        </p>
        {!brand && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show archived
          </label>
        )}
        {!brand && canEditMaster && (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New rule</Button>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {editing === "new" && (
        <MasterRuleForm platformOptions={platformOptions} onClose={() => setEditing(null)} />
      )}

      {RULE_KINDS.map((kind) => {
        const list = shown.filter((r) => r.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">{RULE_KIND_META[kind].label}</h2>
              <p className="text-xs text-muted">{RULE_KIND_META[kind].hint}</p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {list.map((r) => {
                const eff = mine.find((e) => e.id === r.id);
                if (editing === r.id && !brand) {
                  return <MasterRuleForm key={r.id} rule={r} platformOptions={platformOptions} onClose={() => setEditing(null)} />;
                }
                if (editing === r.id && brand && eff) {
                  return <BrandRuleForm key={r.id} rule={r} eff={eff} brand={brand} onClose={() => setEditing(null)} />;
                }
                return (
                  <RuleCard
                    key={r.id}
                    rule={r}
                    eff={eff ?? null}
                    onEdit={(brand ? brand.canPropose : canEditMaster) ? () => setEditing(r.id) : undefined}
                    onArchive={!brand && canEditMaster ? () => run(() => archiveRuleAction(r.id, !r.archived)) : undefined}
                    busy={pending}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RuleCard({ rule, eff, onEdit, onArchive, busy }: {
  rule: MasterRuleView; eff: EffectiveRule | null; onEdit?: () => void; onArchive?: () => void; busy: boolean;
}) {
  const shown = eff ?? { ...rule, customised: [] as LimitKey[], enabled: true, brandNotes: null };
  const lines = describeRule(shown);
  const off = eff && !eff.enabled;
  return (
    <Card className={`p-4 ${rule.archived || off ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {rule.name}
            <span className="font-mono text-[10px] font-normal text-muted">{rule.code}</span>
            <Badge color={shown.enforce === "block" ? "#b91c1c" : "#b45309"}>{ENFORCE_META[shown.enforce].label}</Badge>
            {rule.archived && <Badge>Archived</Badge>}
            {off && <Badge color="#64748b">Off for this brand</Badge>}
            {eff && eff.customised.length > 0 && <Badge color="#7c3aed">{eff.customised.length} changed</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted">{rule.description}</p>
        </div>
        {onEdit && <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${rule.name}`}><Pencil className="size-3.5" /></Button>}
        {onArchive && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onArchive} aria-label={rule.archived ? "Restore" : "Archive"}>
            {rule.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </Button>
        )}
      </div>

      {(rule.platforms.length > 0 || rule.activityCodes.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {rule.platforms.map((p) => <PlatformIcon key={p} platform={p} size={16} />)}
          {rule.activityCodes.map((c) => <span key={c} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{c}</span>)}
        </div>
      )}

      {lines.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {eff && eff.customised.length > 0 && (
        <p className="mt-2 rounded bg-accent-soft px-2 py-1 text-[11px] text-accent">
          This brand&apos;s own: {eff.customised.map((k) => `${LIMIT_FIELDS.find((f) => f.key === k)!.label} ${str(eff.limits[k]) || "none"} (master ${str(rule.limits[k]) || "none"})`).join(" · ")}
        </p>
      )}

      {shown.checklist.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted"><ListChecks className="mr-1 inline size-3.5" />{shown.checklist.length} points to confirm</summary>
          <ul className="mt-1.5 space-y-1 pl-1">
            {shown.checklist.map((i) => (
              <li key={i.id} className="flex items-start gap-1.5">
                <Check className="mt-0.5 size-3 shrink-0 text-muted" />
                <span>{i.text}{i.for !== "all" && <span className="ml-1 text-muted">({CHECK_AUDIENCE_META[i.for].toLowerCase()})</span>}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(rule.instructions || shown.brandNotes) && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">How to do it</summary>
          <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{rule.instructions}</p>
          {shown.brandNotes && <p className="mt-1.5 whitespace-pre-wrap rounded bg-accent-soft px-2 py-1.5 leading-relaxed">{shown.brandNotes}</p>}
        </details>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ limit input */

function LimitInput({ field, value, placeholder, onChange }: {
  field: (typeof LIMIT_FIELDS)[number]; value: string; placeholder?: string; onChange: (v: string) => void;
}) {
  if (field.type === "boolean") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder ? `Master (${placeholder})` : "Not set"}</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (field.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder ? `Master (${placeholder})` : "Not set"}</option>
        {field.choices!.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  return (
    <input
      type={field.type === "number" ? "number" : "text"}
      min={0}
      value={value}
      placeholder={placeholder ?? field.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function LimitsGrid({ values, masterValues, customised, onChange, onReset }: {
  values: Record<string, string>;
  masterValues?: RuleLimits;
  customised?: LimitKey[];
  onChange: (key: LimitKey, v: string) => void;
  onReset?: (key: LimitKey) => void;
}) {
  return (
    <div className="space-y-3">
      {(Object.keys(LIMIT_GROUPS) as (keyof typeof LIMIT_GROUPS)[]).map((g) => (
        <div key={g}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{LIMIT_GROUPS[g]}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {LIMIT_FIELDS.filter((f) => f.group === g).map((f) => {
              const master = masterValues ? str(masterValues[f.key]) : undefined;
              const own = customised?.includes(f.key);
              return (
                <Field key={f.key} label={
                  <span className="flex items-center gap-1.5">
                    {f.label}{f.unit ? <span className="font-normal text-muted">({f.unit})</span> : null}
                    {own && onReset && (
                      <button type="button" onClick={() => onReset(f.key)} className="text-[10px] font-normal text-accent hover:underline" title="Follow the master again">
                        <RotateCcw className="inline size-3" /> master{master ? `: ${master}` : ""}
                      </button>
                    )}
                  </span>
                } hint={f.hint}>
                  <LimitInput field={f} value={values[f.key] ?? ""} placeholder={master || undefined} onChange={(v) => onChange(f.key, v)} />
                </Field>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center gap-1.5">
          <input value={it.text} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="flex-1" />
          <select value={it.for} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, for: e.target.value as ChecklistItem["for"] } : x)))} className="!w-32">
            {CHECK_AUDIENCES.map((a) => <option key={a} value={a}>{CHECK_AUDIENCE_META[a]}</option>)}
          </select>
          <Button size="sm" variant="ghost" aria-label="Remove point" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...items, { id: newItemId(), text: "", for: "all" }])}>
        <Plus className="size-3.5" /> Add a point
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------- master form */

function MasterRuleForm({ rule, platformOptions, onClose }: { rule?: MasterRuleView; platformOptions: { id: string; name: string }[]; onClose: () => void }) {
  const { run, pending, error } = useRun();
  const [name, setName] = useState(rule?.name ?? "");
  const [code, setCode] = useState(rule?.code ?? "");
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? "format");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [instructions, setInstructions] = useState(rule?.instructions ?? "");
  const [platforms, setPlatforms] = useState((rule?.platforms ?? []).join(", "));
  const [activityCodes, setActivityCodes] = useState((rule?.activityCodes ?? []).join(", "));
  const [enforce, setEnforce] = useState<EnforceLevel>(rule?.enforce ?? "block");
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, str(rule?.limits[f.key])])),
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(rule?.checklist ?? []);
  const [reason, setReason] = useState("");

  const unknown = platforms.split(",").map((p) => p.trim()).filter((p) => p && !platformOptions.some((o) => o.id === p));

  return (
    <Card className="space-y-4 p-4 xl:col-span-2">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reel" /></Field>
        <Field label="Code" hint={rule ? "Permanent" : "Blank = from the name"}>
          <input value={code} disabled={Boolean(rule)} onChange={(e) => setCode(e.target.value)} placeholder="reel" />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as RuleKind)}>
            {RULE_KINDS.map((k) => <option key={k} value={k}>{RULE_KIND_META[k].label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="When it applies"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="How to do it" hint="Read by writers, reviewers, Claude drafting and agents.">
        <textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Platforms" hint={unknown.length ? `Unknown: ${unknown.join(", ")}` : "Ids, comma-separated. Blank = all."}>
          <input value={platforms} onChange={(e) => setPlatforms(e.target.value)} placeholder="instagram, facebook" list="playbook-platforms" />
        </Field>
        <datalist id="playbook-platforms">{platformOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</datalist>
        <Field label="Activities it governs" hint="Activity codes, e.g. D-01, 2D-01">
          <input value={activityCodes} onChange={(e) => setActivityCodes(e.target.value)} />
        </Field>
        <Field label="Strictness" hint={ENFORCE_META[enforce].hint}>
          <select value={enforce} onChange={(e) => setEnforce(e.target.value as EnforceLevel)}>
            {ENFORCE_LEVELS.map((l) => <option key={l} value={l}>{ENFORCE_META[l].label}</option>)}
          </select>
        </Field>
      </div>
      <LimitsGrid values={limits} onChange={(k, v) => setLimits((p) => ({ ...p, [k]: v }))} />
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Points to confirm</p>
        <ChecklistEditor items={checklist} onChange={setChecklist} />
      </div>
      <Field label="Why (for the change log)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reels over 60s were losing viewers" /></Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={pending || !name.trim()} onClick={() => run(() => saveRuleAction({
          id: rule?.id, code, kind, name, description, instructions,
          platforms: platforms.split(","), activityCodes: activityCodes.split(","), enforce,
          limits, checklist: checklist.filter((c) => c.text.trim()), reason,
        }), onClose)}>
          Save for every brand
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ brand form */

function BrandRuleForm({ rule, eff, brand, onClose }: { rule: MasterRuleView; eff: EffectiveRule; brand: PlaybookBrand; onClose: () => void }) {
  const { run, pending, error, setError } = useRun();
  const initial = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, eff.customised.includes(f.key) ? str(eff.limits[f.key]) : ""]));
  const [limits, setLimits] = useState<Record<string, string>>(initial);
  const [resets, setResets] = useState<Set<LimitKey>>(new Set());
  const [enabled, setEnabled] = useState(eff.enabled);
  const [enforce, setEnforce] = useState<EnforceLevel>(eff.enforce);
  const [notes, setNotes] = useState(eff.brandNotes ?? "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(eff.checklist);
  const [reason, setReason] = useState("");

  /** Only what actually moved goes to the server, one logged adjustment per field. */
  const changes = useMemo(() => {
    const out: { field: string; value: unknown }[] = [];
    for (const f of LIMIT_FIELDS) {
      if (resets.has(f.key)) { out.push({ field: f.key, value: "inherit" }); continue; }
      const v = limits[f.key];
      if (v === initial[f.key]) continue;
      // Cleared a brand value → back to the master.
      out.push({ field: f.key, value: v === "" ? "inherit" : v });
    }
    if (enabled !== eff.enabled) out.push({ field: "enabled", value: enabled });
    if (enforce !== eff.enforce) out.push({ field: "enforce", value: enforce });
    if (notes.trim() !== (eff.brandNotes ?? "")) out.push({ field: "instructions", value: notes });
    const clean = checklist.filter((c) => c.text.trim());
    if (JSON.stringify(clean) !== JSON.stringify(eff.checklist)) out.push({ field: "checklist", value: clean });
    return out;
  }, [limits, resets, enabled, enforce, notes, checklist, eff, initial]);

  function save() {
    if (!changes.length) { onClose(); return; }
    if (!brand.canApply && !reason.trim()) { setError("Say why — an approver decides this in the daily review."); return; }
    run(async () => {
      for (const c of changes) {
        const res = await adjustBrandRuleAction({ brandId: brand.id, ruleId: rule.id, field: c.field, value: c.value, reason });
        if (!res.ok) return res;
      }
      return { ok: true as const };
    }, onClose);
  }

  return (
    <Card className="space-y-4 p-4 xl:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm font-semibold">{rule.name} <span className="font-normal text-muted">for {brand.name}</span></p>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Applies to this brand
        </label>
        <select value={enforce} onChange={(e) => setEnforce(e.target.value as EnforceLevel)} className="!w-28" aria-label="Strictness">
          {ENFORCE_LEVELS.map((l) => <option key={l} value={l}>{ENFORCE_META[l].label}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted">Blank = follow the master (shown greyed). Type a value to set this brand&apos;s own.</p>
      <LimitsGrid
        values={limits}
        masterValues={rule.limits}
        customised={eff.customised.filter((k) => !resets.has(k))}
        onChange={(k, v) => { setLimits((p) => ({ ...p, [k]: v })); setResets((r) => { const n = new Set(r); n.delete(k); return n; }); }}
        onReset={(k) => { setResets((r) => new Set(r).add(k)); setLimits((p) => ({ ...p, [k]: "" })); }}
      />
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Points to confirm</p>
        <ChecklistEditor items={checklist} onChange={setChecklist} />
      </div>
      <Field label={`${brand.name}'s own instructions`} hint="Shown after the master's.">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field label="Why" hint={brand.canApply ? "Kept in the change log." : "Required — your change goes to the daily review."}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">{changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={pending} onClick={save}>
          {brand.canApply ? "Save for this brand" : "Suggest"}
        </Button>
      </div>
    </Card>
  );
}

/* ================================================================= review */

export type AdjustmentView = {
  id: string;
  ruleName: string;
  ruleCode: string;
  brandId: string | null;
  field: string;
  before: string | null;
  after: string | null;
  reason: string;
  evidence: Record<string, unknown> | null;
  status: AdjustStatus;
  source: AdjustSource;
  actorKind: "human" | "ai";
  actorName: string | null;
  decidedName: string | null;
  decidedKind: "human" | "ai" | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  canDecide: boolean;
};

function afterText(a: AdjustmentView) {
  if (a.after === null && a.brandId) return "Back to the master's value";
  return readableValue(a.field, a.after);
}

/**
 * The daily review: every open suggestion, from people, agents and the tuning
 * job, with the numbers behind it, then the history of what changed.
 */
export function PlaybookReview({ adjustments, brands, mode }: {
  adjustments: AdjustmentView[];
  brands: { id: string; name: string; color: string }[];
  mode: "open" | "history";
}) {
  const { run, pending, error } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const brandOf = (id: string | null) => brands.find((b) => b.id === id);

  if (adjustments.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted">
        {mode === "open" ? "Nothing waiting. Suggestions from people, agents and the daily tuning job land here." : "No changes yet."}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {adjustments.map((a) => {
        const b = brandOf(a.brandId);
        const status = ADJUST_STATUS_META[a.status];
        const best = Array.isArray(a.evidence?.best) ? a.evidence!.best as { slot: string; posts: number; rate: number }[] : null;
        return (
          <Card key={a.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                {b ? <><span className="size-2 rounded-full" style={{ background: b.color }} />{b.name}</> : "Master"}
              </span>
              <span className="text-muted">·</span>
              <span>{a.ruleName}</span>
              <span className="text-muted">·</span>
              <span className="font-medium">{adjustFieldLabel(a.field)}</span>
              <span className="ml-auto"><Badge color={status.color}>{status.label}</Badge></span>
            </div>

            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-lg bg-surface-2 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">Before</p>
                <p className="whitespace-pre-wrap">{readableValue(a.field, a.before)}</p>
              </div>
              <div className="rounded-lg bg-accent-soft px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">After</p>
                <p className="whitespace-pre-wrap font-medium">{afterText(a)}</p>
              </div>
            </div>

            {a.reason && <p className="mt-2 text-sm">{a.reason}</p>}
            {best && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {best.map((s) => <span key={s.slot} className="rounded bg-surface-2 px-1.5 py-0.5">{s.slot}: {s.rate}% over {s.posts} posts</span>)}
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">baseline {String(a.evidence!.base)}%</span>
              </div>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted">
              {a.actorKind === "ai" ? <Bot className="size-3" /> : <User className="size-3" />}
              {a.actorName ?? "Someone"} · {ADJUST_SOURCE_META[a.source]} · {relativeTime(a.createdAt)}
              {a.decidedAt && a.status !== "proposed" && a.source !== "manual" && (
                <> · {a.status === "applied" ? "approved" : a.status} by {a.decidedName ?? "someone"}{a.decidedKind === "ai" ? " (agent)" : ""} {relativeTime(a.decidedAt)}</>
              )}
            </p>
            {a.decisionNote && <p className="mt-1 text-xs italic text-muted">“{a.decisionNote}”</p>}

            {a.status === "proposed" && a.canDecide && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input className="min-w-40 flex-1" placeholder="Note (optional)" value={notes[a.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} />
                <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => decideAdjustmentAction({ id: a.id, decision: "applied", note: notes[a.id] }))}>
                  <Check className="size-3.5" /> Approve
                </Button>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => decideAdjustmentAction({ id: a.id, decision: "rejected", note: notes[a.id] }))}>
                  <X className="size-3.5" /> Reject
                </Button>
              </div>
            )}
            {a.status === "proposed" && !a.canDecide && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted"><CircleSlash className="size-3" /> An approver or admin on this brand decides this.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
