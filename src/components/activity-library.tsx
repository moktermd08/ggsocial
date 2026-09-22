"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Bot, Pencil, Plus, Search, Timer } from "lucide-react";
import { Badge, Button, Card, Field } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { tintedInk, tintedSurface } from "@/lib/color";
import {
  ACTIVITY_CATEGORIES, CATEGORY_META, FREQUENCIES, FREQUENCY_META, LEAD_IMPACTS, PERFORMERS, PERFORMER_META,
  PROOF_KINDS, PROOF_META, targetText, type ActivityCategory, type Frequency, type LeadImpact, type Performer, type ProofKind,
} from "@/lib/activities/meta";
import {
  archiveTemplateAction, saveTemplateAction, setBrandActivityAction, type TemplateInput,
} from "@/server/actions/activities";

export type LibraryTemplate = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: ActivityCategory;
  frequency: Frequency;
  platforms: string[];
  target: number;
  unit: string;
  proof: ProofKind;
  performer: Performer;
  leadImpact: LeadImpact;
  estMinutes: number;
  isCustom: boolean;
  archived: boolean;
};

export type LibraryBrand = { id: string; name: string; color: string; canManage: boolean; platforms: string[] };
export type LibrarySetting = { enabled: boolean | null; target: number | null };

/** Occurrences per week on a five-day working week, for sizing a plan in hours. */
const PER_WEEK: Record<Frequency, number> = {
  daily: 5, every_2_days: 2.5, weekly: 1, monthly: 12 / 52, quarterly: 4 / 52, half_yearly: 2 / 52, yearly: 1 / 52,
};

/**
 * The master template, and each brand's plan cut from it. Editing a row here
 * changes it for every brand; the brand switches on the right only change that
 * brand's plan.
 */
export function ActivityLibrary({
  templates, brands, settings, canEditMaster, platformOptions,
}: {
  templates: LibraryTemplate[];
  brands: LibraryBrand[];
  settings: Record<string, LibrarySetting>;
  canEditMaster: boolean;
  platformOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [frequency, setFrequency] = useState<"all" | Frequency>("all");
  const [category, setCategory] = useState<"all" | ActivityCategory>("all");
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  function run(work: () => Promise<unknown>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        after?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    });
  }

  /** On the brand's plan? An explicit switch wins; otherwise general = on, platform-specific = on where the brand has it. */
  function state(b: LibraryBrand, t: LibraryTemplate) {
    const byDefault = t.platforms.length === 0 || t.platforms.some((p) => b.platforms.includes(p));
    const s = settings[`${b.id}:${t.id}`];
    return { on: s?.enabled ?? byDefault, byDefault, overridden: s?.enabled != null };
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (!showRetired && t.archived) return false;
      if (frequency !== "all" && t.frequency !== frequency) return false;
      if (category !== "all" && t.category !== category) return false;
      if (!q) return true;
      return [t.code, t.title, t.description, ...t.platforms].some((v) => v.toLowerCase().includes(q));
    });
  }, [templates, query, frequency, category, showRetired]);

  const active = templates.filter((t) => !t.archived);
  const hoursFor = (b: LibraryBrand) =>
    active.filter((t) => state(b, t).on).reduce((s, t) => s + t.estMinutes * PER_WEEK[t.frequency], 0) / 60;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card className="p-4">
          <p className="text-xs text-muted">Master template · {active.length} activities</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FREQUENCIES.map((f) => {
              const n = active.filter((t) => t.frequency === f).length;
              const on = frequency === f;
              return (
                <button key={f} type="button" onClick={() => setFrequency(on ? "all" : f)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted hover:bg-surface-2"}`}>
                  {FREQUENCY_META[f].label} <span className="tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ACTIVITY_CATEGORIES.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 text-[11px] text-muted">
                <span className="size-2 rounded-sm" style={{ background: CATEGORY_META[c].color }} />
                {CATEGORY_META[c].label} {active.filter((t) => t.category === c).length}
              </span>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Time each brand&apos;s plan needs (5-day week, estimates)</p>
          <ul className="mt-2 space-y-1.5">
            {brands.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full" style={{ background: b.color }} />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span className="tabular-nums font-medium">≈ {hoursFor(b).toFixed(1)} h/week</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the master list…" className="!w-full !py-1.5 !pl-8 !text-sm" />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="!w-auto !py-1.5 !text-sm" aria-label="Category">
          <option value="all">All categories</option>
          {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} className="!w-auto" /> Show retired
        </label>
        {canEditMaster && (
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}><Plus className="size-3.5" /> Add activity</Button>
        )}
      </div>

      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {editing === "new" && (
        <TemplateForm platformOptions={platformOptions} pending={pending} onCancel={() => setEditing(null)}
          onSave={(input) => run(() => saveTemplateAction(input), () => setEditing(null))} />
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pl-3 pr-3 font-medium">Activity</th>
              <th className="w-28 px-2 py-2 font-medium">Target</th>
              {brands.map((b) => (
                <th key={b.id} className="w-20 px-1 py-2 text-center font-medium">
                  <span className="inline-flex max-w-20 items-center gap-1 truncate" title={`${b.name}'s plan`}>
                    <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} /><span className="truncate">{b.name}</span>
                  </span>
                </th>
              ))}
              {canEditMaster && <th className="w-20 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {FREQUENCIES.map((f) => {
              const list = visible.filter((t) => t.frequency === f);
              if (list.length === 0) return null;
              return (
                <Fragment key={f}>
                  <tr className="border-b border-border bg-surface-2/60">
                    <td colSpan={brands.length + 3} className="px-3 py-1.5 text-xs font-semibold">
                      {FREQUENCY_META[f].label} <span className="font-normal text-muted">{list.length}</span>
                    </td>
                  </tr>
                  {list.map((t) => editing === t.id ? (
                    <tr key={t.id} className="border-b border-border">
                      <td colSpan={brands.length + 3} className="p-3">
                        <TemplateForm initial={t} platformOptions={platformOptions} pending={pending} onCancel={() => setEditing(null)}
                          onSave={(input) => run(() => saveTemplateAction({ ...input, id: t.id }), () => setEditing(null))} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id} className={`border-b border-border align-top ${t.archived ? "opacity-50" : ""}`}>
                      <td className="py-2 pl-3 pr-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{t.code}</span>
                          <div className="min-w-0">
                            <p className="font-medium leading-snug">{t.title}{t.isCustom && <span className="ml-1.5 text-[10px] font-normal text-muted">custom</span>}</p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted" title={t.description}>{t.description}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                              <span className="inline-flex items-center gap-1" style={{ color: tintedInk(CATEGORY_META[t.category].color, 80) }}>
                                <span className="size-2 rounded-sm" style={{ background: CATEGORY_META[t.category].color }} />{CATEGORY_META[t.category].label}
                              </span>
                              <span className="inline-flex items-center gap-0.5"><Timer className="size-3" />{t.estMinutes}m</span>
                              {t.performer !== "human" && <span className="inline-flex items-center gap-0.5"><Bot className="size-3" />{PERFORMER_META[t.performer].label}</span>}
                              {t.platforms.length > 0 && (
                                <span className="inline-flex items-center gap-0.5" title={t.platforms.join(", ")}>
                                  {t.platforms.slice(0, 7).map((p) => <PlatformIcon key={p} platform={p} size={13} variant="glyph" />)}
                                  {t.platforms.length > 7 && <span>+{t.platforms.length - 7}</span>}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <span className="font-medium">{targetText(t.target, t.unit)}</span>
                        <p className="mt-0.5 text-[11px] text-muted">{t.leadImpact} impact</p>
                      </td>
                      {brands.map((b) => {
                        const s = state(b, t);
                        return (
                          <td key={b.id} className="px-1 py-2 text-center">
                            <button
                              type="button"
                              disabled={pending || !b.canManage || t.archived}
                              onClick={() => {
                                const next = !s.on;
                                run(() => setBrandActivityAction({ brandId: b.id, templateId: t.id, enabled: next === s.byDefault ? null : next }));
                              }}
                              title={`${s.on ? "On" : "Off"} for ${b.name}${s.overridden ? " (changed from the default)" : t.platforms.length && !s.byDefault ? " — no channel on these platforms" : ""}${b.canManage ? " — click to switch" : ""}`}
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium disabled:cursor-default ${s.on ? "" : "border-border text-muted"}`}
                              style={s.on ? { borderColor: b.color, background: tintedSurface(b.color), color: tintedInk(b.color) } : undefined}
                            >
                              {s.on ? "On" : "Off"}{s.overridden && "*"}
                            </button>
                          </td>
                        );
                      })}
                      {canEditMaster && (
                        <td className="px-2 py-2 text-right">
                          <div className="flex justify-end gap-0.5">
                            <Button size="sm" variant="ghost" aria-label={`Edit ${t.code}`} onClick={() => setEditing(t.id)}><Pencil className="size-3.5" /></Button>
                            <Button size="sm" variant="ghost" aria-label={t.archived ? `Restore ${t.code}` : `Retire ${t.code}`} disabled={pending}
                              onClick={() => run(() => archiveTemplateAction(t.id, !t.archived))} title={t.archived ? "Restore" : "Retire from every brand's plan (history is kept)"}>
                              {t.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-[11px] text-muted">
        * switched from the default for that brand. Platform-specific activities are on automatically for brands that have a channel on one of those platforms.
      </p>
    </div>
  );
}

function TemplateForm({
  initial, platformOptions, pending, onSave, onCancel,
}: {
  initial?: LibraryTemplate;
  platformOptions: { id: string; name: string }[];
  pending: boolean;
  onSave: (input: TemplateInput) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState({
    code: initial?.code ?? "",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    category: initial?.category ?? ("engagement" as ActivityCategory),
    frequency: initial?.frequency ?? ("weekly" as Frequency),
    platforms: initial?.platforms.join(", ") ?? "",
    target: String(initial?.target ?? 1),
    unit: initial?.unit ?? "time",
    proof: initial?.proof ?? ("note" as ProofKind),
    performer: initial?.performer ?? ("human" as Performer),
    leadImpact: initial?.leadImpact ?? ("medium" as LeadImpact),
    estMinutes: String(initial?.estMinutes ?? 15),
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));
  const platformIds = v.platforms.split(",").map((s) => s.trim()).filter(Boolean);
  const known = new Set(platformOptions.map((p) => p.id));
  const unknown = platformIds.filter((p) => !known.has(p));

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-semibold">{initial ? `Edit ${initial.code} — changes every brand's plan` : "New activity for every brand"}</p>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label="Code" hint={initial ? "Permanent" : "Optional, e.g. W-40"}>
          <input value={v.code} disabled={Boolean(initial)} onChange={(e) => set("code", e.target.value)} placeholder="auto" />
        </Field>
        <Field label="Title"><input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Comment on posts from prospects" /></Field>
      </div>
      <Field label="How to do it"><textarea rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Frequency">
          <select value={v.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_META[f].label}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select value={v.category} onChange={(e) => set("category", e.target.value as ActivityCategory)}>
            {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
          </select>
        </Field>
        <Field label="Who can do it">
          <select value={v.performer} onChange={(e) => set("performer", e.target.value as Performer)}>
            {PERFORMERS.map((p) => <option key={p} value={p}>{PERFORMER_META[p].label}</option>)}
          </select>
        </Field>
        <Field label="Target"><input type="number" min={1} value={v.target} onChange={(e) => set("target", e.target.value)} /></Field>
        <Field label="Unit"><input value={v.unit} onChange={(e) => set("unit", e.target.value)} placeholder="comments" /></Field>
        <Field label="Minutes per period"><input type="number" min={1} value={v.estMinutes} onChange={(e) => set("estMinutes", e.target.value)} /></Field>
        <Field label="Proof">
          <select value={v.proof} onChange={(e) => set("proof", e.target.value as ProofKind)}>
            {PROOF_KINDS.map((p) => <option key={p} value={p}>{PROOF_META[p]}</option>)}
          </select>
        </Field>
        <Field label="Lead impact">
          <select value={v.leadImpact} onChange={(e) => set("leadImpact", e.target.value as LeadImpact)}>
            {LEAD_IMPACTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <Field
        label="Only on these platforms (leave empty for every platform)"
        hint={unknown.length ? `Unknown platform id: ${unknown.join(", ")}` : "Comma-separated platform ids, e.g. linkedin, instagram, google_business"}
      >
        <input list="platform-ids" value={v.platforms} onChange={(e) => set("platforms", e.target.value)} placeholder="linkedin, instagram" />
      </Field>
      <datalist id="platform-ids">{platformOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</datalist>
      {platformIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {platformIds.filter((p) => known.has(p)).map((p) => (
            <Badge key={p}><PlatformIcon platform={p} size={12} variant="glyph" />{platformOptions.find((o) => o.id === p)?.name}</Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending || !v.title.trim() || unknown.length > 0} onClick={() => onSave({
          code: v.code || undefined, title: v.title, description: v.description, category: v.category, frequency: v.frequency,
          platforms: platformIds, target: Number(v.target), unit: v.unit, proof: v.proof, performer: v.performer,
          leadImpact: v.leadImpact, estMinutes: Number(v.estMinutes),
        })}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
