"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field } from "./ui";
import { GOAL_METRICS, METRIC_META, singular, type DriverSpec, type GoalMetric } from "@/lib/goals/meta";
import { archiveGoalTemplateAction, saveGoalTemplateAction } from "@/server/actions/goals";
import type { ActionResult } from "@/lib/action-result";

export type TemplateView = {
  id: string; code: string; metric: GoalMetric; name: string; description: string; drivers: DriverSpec[];
  isCustom: boolean; archived: boolean; goalCount: number;
};

/**
 * The master goal templates every brand's goals start from: the metric, the
 * activities that move it and a benchmark for each. Changing a template
 * shapes new goals; existing goals keep their own (learned) numbers.
 */
export function GoalTemplates({ templates, activities, canEdit }: {
  templates: TemplateView[];
  activities: { code: string; title: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const titleOf = new Map(activities.map((a) => [a.code, a.title]));

  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) { setError(res.error); return; }
        after?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const visible = templates.filter((t) => showArchived || !t.archived);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">
          Each template says which activities move a metric, how much each one is expected to bring (the benchmark yield), what share of the
          growth it should carry, and the most that is realistic per week. New goals copy these; every goal then re-learns the yields from its brand&apos;s own results.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" className="!w-auto" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show retired
          </label>
          {canEdit && <Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New template</Button>}
        </div>
      </div>
      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {editing === "new" && (
        <TemplateForm activities={activities} pending={pending} onCancel={() => setEditing(null)}
          onSave={(input) => run(() => saveGoalTemplateAction(input), () => setEditing(null))} />
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {visible.map((t) => editing === t.id ? (
          <TemplateForm key={t.id} initial={t} activities={activities} pending={pending} onCancel={() => setEditing(null)}
            onSave={(input) => run(() => saveGoalTemplateAction({ ...input, id: t.id }), () => setEditing(null))} />
        ) : (
          <Card key={t.id} className={t.archived ? "opacity-60" : ""}>
            <CardHeader
              title={<>{t.name} <Badge color={METRIC_META[t.metric].color}>{METRIC_META[t.metric].label}</Badge>{t.isCustom && <span className="text-[10px] font-normal text-muted">custom</span>}</>}
              subtitle={t.description}
              action={canEdit && (
                <div className="flex shrink-0 gap-0.5">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t.id)}><Pencil className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" disabled={pending} aria-label={t.archived ? "Restore" : "Retire"} title={t.archived ? "Restore" : "Retire (existing goals keep working)"}
                    onClick={() => run(() => archiveGoalTemplateAction(t.id, !t.archived))}>
                    {t.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                  </Button>
                </div>
              )}
            />
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-1.5 font-medium">Activity</th>
                  <th className="px-2 py-1.5 text-right font-medium">Benchmark yield</th>
                  <th className="px-2 py-1.5 text-right font-medium">Share</th>
                  <th className="px-4 py-1.5 text-right font-medium">Cap / wk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {t.drivers.map((d) => (
                  <tr key={d.activityCode}>
                    <td className="px-4 py-1.5">
                      <span className="font-medium">{d.label}</span>
                      <span className="ml-1.5 font-mono text-[10px] text-muted" title={titleOf.get(d.activityCode) ?? "missing from the master list"}>{d.activityCode}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {d.yield} <span className="text-muted">{METRIC_META[t.metric].noun} / {singular(d.unitLabel)}{d.scale === "audience" ? " per 1k audience" : ""}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(d.share * 100)}%</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{d.maxPerWeek}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted">{t.goalCount} goal{t.goalCount === 1 ? "" : "s"} started from this template · <span className="font-mono">{t.code}</span></p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TemplateForm({ initial, activities, pending, onSave, onCancel }: {
  initial?: TemplateView;
  activities: { code: string; title: string }[];
  pending: boolean;
  onSave: (input: { metric: GoalMetric; name: string; description: string; drivers: DriverSpec[] }) => void;
  onCancel: () => void;
}) {
  const [metric, setMetric] = useState<GoalMetric>(initial?.metric ?? "followers");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [drivers, setDrivers] = useState<DriverSpec[]>(initial?.drivers ?? [
    { activityCode: "", label: "", unitLabel: "", yield: 1, scale: "fixed", share: 1, maxPerWeek: 7 },
  ]);
  const set = (i: number, patch: Partial<DriverSpec>) => setDrivers((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const total = drivers.reduce((s, d) => s + d.share, 0) || 1;

  return (
    <Card className="xl:col-span-2">
      <CardHeader title={initial ? `Edit ${initial.name}` : "New goal template"} subtitle="Shares are normalised to add up to 100% when you save." />
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
          <Field label="Metric">
            <select value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
              {GOAL_METRICS.map((m) => <option key={m} value={m}>{METRIC_META[m].label}</option>)}
            </select>
          </Field>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Grow followers" /></Field>
          <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <p className="text-[11px] text-muted">{METRIC_META[metric].how}</p>
        <datalist id="goal-activity-codes">
          {activities.map((a) => <option key={a.code} value={a.code}>{a.title}</option>)}
        </datalist>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pl-4 font-medium">Activity code</th>
                <th className="px-1 py-1 font-medium">Label</th>
                <th className="px-1 py-1 font-medium">Unit (plural)</th>
                <th className="px-1 py-1 text-right font-medium">Yield</th>
                <th className="px-1 py-1 font-medium">Scales with</th>
                <th className="px-1 py-1 text-right font-medium">Share %</th>
                <th className="px-1 py-1 text-right font-medium">Cap / wk</th>
                <th className="py-1 pr-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drivers.map((d, i) => (
                <tr key={i}>
                  <td className="py-1 pl-4">
                    <input list="goal-activity-codes" className="!w-24 !py-0.5 !font-mono !text-xs" value={d.activityCode}
                      onChange={(e) => set(i, { activityCode: e.target.value.toUpperCase() })} placeholder="2D-01" />
                    <span className="block max-w-40 truncate text-[10px] text-muted">{activities.find((a) => a.code === d.activityCode)?.title ?? " "}</span>
                  </td>
                  <td className="px-1 py-1"><input className="!py-0.5 !text-xs" value={d.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Short-form videos" /></td>
                  <td className="px-1 py-1"><input className="!w-24 !py-0.5 !text-xs" value={d.unitLabel} onChange={(e) => set(i, { unitLabel: e.target.value })} placeholder="videos" /></td>
                  <td className="px-1 py-1 text-right"><input type="number" min={0} step="any" className="!w-20 !py-0.5 !text-right !text-xs" value={d.yield} onChange={(e) => set(i, { yield: Number(e.target.value) })} /></td>
                  <td className="px-1 py-1">
                    <select className="!w-auto !py-0.5 !text-xs" value={d.scale} onChange={(e) => set(i, { scale: e.target.value as DriverSpec["scale"] })}>
                      <option value="fixed">Nothing (fixed)</option>
                      <option value="audience">Audience (per 1k)</option>
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right"><input type="number" min={0} className="!w-16 !py-0.5 !text-right !text-xs" value={Math.round((d.share / total) * 100)} onChange={(e) => set(i, { share: (Number(e.target.value) / 100) * total })} /></td>
                  <td className="px-1 py-1 text-right"><input type="number" min={1} className="!w-16 !py-0.5 !text-right !text-xs" value={d.maxPerWeek} onChange={(e) => set(i, { maxPerWeek: Number(e.target.value) })} /></td>
                  <td className="py-1 pr-4 text-right">
                    <Button size="sm" variant="ghost" aria-label="Remove activity" onClick={() => setDrivers((list) => list.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDrivers((list) => [...list, { activityCode: "", label: "", unitLabel: "", yield: 1, scale: "fixed", share: 0.1, maxPerWeek: 7 }])}>
            <Plus className="size-3.5" /> Add activity
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => onSave({ metric, name, description, drivers })}>
            {pending && <Loader2 className="size-3.5 animate-spin" />} Save template
          </Button>
        </div>
      </div>
    </Card>
  );
}
