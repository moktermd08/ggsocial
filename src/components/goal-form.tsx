"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button, Card, CardHeader, Field, SectionTitle } from "./ui";
import { PlanChart, type PlanPoint } from "./charts";
import {
  CURVES, CURVE_META, METRIC_META, compact, perPeriodText, singular, targetPhrase,
  type Curve, type DriverSpec, type GoalDriver, type GoalMetric,
} from "@/lib/goals/meta";
import { addDays, buildPlan, daysBetween, effectiveYield, pathValue, weeklyGrowthRate, type ActivityInfo, type GoalPath } from "@/lib/goals/engine";
import { createGoalAction, goalStartingPointAction, resetGoalDriversAction, updateGoalAction } from "@/server/actions/goals";

export type FormActivity = ActivityInfo & { title: string; platforms: string[] };
export type FormBrand = { id: string; name: string; color: string; platforms: { id: string; name: string }[] };
export type FormTemplate = { id: string; metric: GoalMetric; name: string; description: string; drivers: DriverSpec[] };
export type FormGoal = {
  id: string; brandId: string; metric: GoalMetric; name: string; platform: string | null; platformName: string | null;
  startValue: number; startDate: string; targetValue: number; deadline: string; curve: Curve; approvalThreshold: number;
  notes: string | null; drivers: GoalDriver[]; baseline: number;
  /** Where the preview starts: today's actual if known, else the plan's anchor. */
  nowDate: string; nowValue: number; audience: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
const num = (s: string) => Number(s.replace(/[, _]/g, ""));

function fits(a: FormActivity | undefined, platforms: string[], goalPlatform: string | null) {
  if (!a) return false;
  if (a.platforms.length === 0) return true;
  return goalPlatform ? a.platforms.includes(goalPlatform) && platforms.includes(goalPlatform) : a.platforms.some((p) => platforms.includes(p));
}

/**
 * Creating or editing a brand goal, with the plan worked out live as the
 * numbers change: the growth it implies, what each activity must do per week,
 * the hours it takes, and whether it can be reached at all.
 */
export function GoalForm(props: {
  mode: "create";
  brands: FormBrand[];
  templates: FormTemplate[];
  activities: Record<string, FormActivity>;
  today: string;
  defaultBrandId?: string;
  defaultTemplateId?: string;
} | {
  mode: "edit";
  goal: FormGoal;
  brandPlatforms: string[];
  activities: Record<string, FormActivity>;
  canReset: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const create = props.mode === "create";
  const activities = props.activities;

  const [brandId, setBrandId] = useState(create ? props.defaultBrandId ?? props.brands[0]?.id ?? "" : props.goal.brandId);
  const [templateId, setTemplateId] = useState(create ? props.defaultTemplateId ?? props.templates[0]?.id ?? "" : "");
  const [platform, setPlatform] = useState<string | null>(create ? null : props.goal.platform);
  const [name, setName] = useState(create ? "" : props.goal.name);
  const [startText, setStartText] = useState(create ? "" : String(Math.round(props.goal.startValue)));
  const [startTouched, setStartTouched] = useState(!create);
  const [targetText, setTargetText] = useState(create ? "" : String(Math.round(props.goal.targetValue)));
  const [deadline, setDeadline] = useState(create ? addDays(props.today, 365) : props.goal.deadline);
  const [curve, setCurve] = useState<Curve>(create ? "compound" : props.goal.curve);
  const [threshold, setThreshold] = useState(create ? 30 : props.goal.approvalThreshold);
  const [notes, setNotes] = useState(create ? "" : props.goal.notes ?? "");
  const [audience, setAudience] = useState<number | null>(create ? null : props.goal.audience);
  const [lookup, setLookup] = useState<{ key: string; current: number | null; latest: string | null }>({ key: "", current: null, latest: null });

  const brand = create ? props.brands.find((b) => b.id === brandId) : undefined;
  const template = create ? props.templates.find((t) => t.id === templateId) : undefined;
  const metric: GoalMetric = create ? template?.metric ?? "followers" : props.goal.metric;
  const meta = METRIC_META[metric];
  const platformIds = create ? brand?.platforms.map((p) => p.id) ?? [] : props.brandPlatforms;

  // Edits to the drivers belong to one brand + template + platform; picking another starts from its defaults.
  const driverKey = `${brandId}|${templateId}|${platform ?? ""}`;
  const baseDrivers = useMemo<GoalDriver[]>(() => {
    if (!create) return props.goal.drivers;
    return (template?.drivers ?? []).map((d) => ({ ...d, priorYield: d.yield, enabled: fits(activities[d.activityCode], platformIds, platform) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverKey]);
  const [edited, setEdited] = useState<{ key: string; drivers: GoalDriver[] } | null>(null);
  const drivers = edited?.key === driverKey ? edited.drivers : baseDrivers;

  // Where the brand stands today, to prefill "now" for a new goal.
  const lookupKey = create && brandId && template ? `${brandId}|${template.metric}|${platform ?? ""}` : "";
  const lookingUp = lookupKey !== "" && lookup.key !== lookupKey;
  useEffect(() => {
    if (!lookupKey || !template) return;
    let live = true;
    goalStartingPointAction({ brandId, metric: template.metric, platform })
      .then((r) => {
        if (!live) return;
        setLookup({ key: lookupKey, current: r.current, latest: r.latestReading });
        setAudience(r.audience);
        if (!startTouched && r.current !== null) setStartText(String(Math.round(r.current)));
      })
      .catch(() => live && setLookup({ key: lookupKey, current: null, latest: null }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey]);

  const startValue = create ? num(startText) : props.goal.startValue;
  const targetValue = num(targetText);
  const anchorDate = create ? props.today : props.goal.nowDate;
  const anchorValue = create ? startValue : props.goal.nowValue;
  const valid = Number.isFinite(startValue) && startValue >= 0 && Number.isFinite(targetValue) && targetValue > anchorValue
    && daysBetween(anchorDate, deadline) >= 7;

  const planAudience = meta.kind === "stock" ? anchorValue : audience ?? 1000;
  const plan = useMemo(() => valid ? buildPlan({
    kind: meta.kind, curve, anchorDate, anchorValue, targetValue, deadline, drivers,
    baseline: create ? 0 : props.goal.baseline, audience: planAudience, activities,
  }) : null, [valid, meta.kind, curve, anchorDate, anchorValue, targetValue, deadline, drivers, create, props, planAudience, activities]);

  const path = useMemo<GoalPath | null>(
    () => (valid ? { kind: meta.kind, curve, anchorDate, anchorValue, targetValue, deadline } : null),
    [valid, meta.kind, curve, anchorDate, anchorValue, targetValue, deadline],
  );
  const growth = path ? weeklyGrowthRate(path) : null;
  const lastWeek = path ? pathValue(path, deadline) - pathValue(path, addDays(deadline, -7)) : 0;

  const chart: PlanPoint[] = useMemo(() => {
    if (!path) return [];
    const total = daysBetween(anchorDate, deadline);
    const step = Math.max(1, Math.ceil(total / 60));
    const pts: PlanPoint[] = [];
    for (let d = anchorDate; ; d = addDays(d, step)) {
      const date = d > deadline ? deadline : d;
      pts.push({ date, label: label(date), original: pathValue(path, date), current: null, actual: null });
      if (date >= deadline) break;
    }
    return pts;
  }, [path, anchorDate, deadline]);

  const milestones = useMemo(() => {
    if (!path) return [];
    const months = daysBetween(anchorDate, deadline) / 30.44;
    const every = months > 24 ? 3 : 1;
    const out: { date: string; value: number }[] = [];
    let [y, m] = [Number(anchorDate.slice(0, 4)), Number(anchorDate.slice(5, 7)) - 1];
    for (let i = 0; i < 40; i++) {
      m += every;
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      if (end >= deadline) break;
      if (end > anchorDate) out.push({ date: end, value: pathValue(path, end) });
      if (m > 11) { y += Math.floor(m / 12); m %= 12; }
    }
    out.push({ date: deadline, value: targetValue });
    return out;
  }, [path, anchorDate, deadline, targetValue]);

  function setDriver(code: string, patch: Partial<GoalDriver>) {
    setEdited({ key: driverKey, drivers: drivers.map((d) => (d.activityCode === code ? { ...d, ...patch } : d)) });
  }

  function submit() {
    setError(null);
    start(async () => {
      try {
        const edits = drivers.map((d) => ({ activityCode: d.activityCode, enabled: d.enabled, share: d.share, maxPerWeek: d.maxPerWeek, yield: d.yield }));
        if (create) {
          const res = await createGoalAction({
            brandId, templateId, platform, name: name || undefined, startValue, targetValue, deadline, curve, drivers: edits,
          });
          router.push(`/goals/${res.id}`);
        } else {
          await updateGoalAction({
            goalId: props.goal.id, name, targetValue, deadline, curve, approvalThreshold: threshold, notes: notes || null, drivers: edits,
          });
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const shareTotal = drivers.filter((d) => d.enabled).reduce((s, d) => s + d.share, 0) || 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title={create ? "The goal" : "Goal settings"} subtitle={create ? "Pick what to grow, where you are and where you want to be." : "Changing these re-plans the goal straight away."} />
        <div className="space-y-4 p-4">
          {create && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Brand">
                  <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setPlatform(null); setStartTouched(false); }}>
                    {props.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </Field>
                <Field label="Where" hint="All channels together, or one platform on its own.">
                  <select value={platform ?? ""} onChange={(e) => { setPlatform(e.target.value || null); setStartTouched(false); }}>
                    <option value="">All platforms</option>
                    {brand?.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Goal template" hint={template?.description}>
                <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setStartTouched(false); setTargetText(""); }}>
                  {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {METRIC_META[t.metric].label}</option>)}
                </select>
              </Field>
            </>
          )}
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={template?.name ?? "Goal name"} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {create ? (
              <Field
                label={meta.kind === "stock" ? `${meta.label} now` : `${meta.label} a month now`}
                hint={lookingUp ? "Looking up today's number…" : lookup.current !== null
                  ? `Measured: ${Math.round(lookup.current).toLocaleString()}${meta.kind === "flow" ? " over the last 28 days, as a monthly rate" : lookup.latest ? ` (last logged ${lookup.latest})` : ""}.`
                  : meta.kind === "stock" ? "No counts logged yet — type today's total." : "Nothing counted yet — type your best estimate."}
              >
                <input inputMode="numeric" value={startText} onChange={(e) => { setStartText(e.target.value); setStartTouched(true); }} placeholder="50000" />
              </Field>
            ) : (
              <Field label="Started at" hint={`On ${props.goal.startDate}. Fixed, so progress stays comparable.`}>
                <input value={Math.round(props.goal.startValue).toLocaleString()} disabled />
              </Field>
            )}
            <Field label={meta.kind === "stock" ? `Target ${meta.noun}` : `Target ${meta.noun} a month`}>
              <input inputMode="numeric" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder={meta.kind === "stock" ? "1000000" : "10000"} />
            </Field>
            <Field label="Deadline"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
            <Field label="Growth curve" hint={CURVE_META[curve].hint}>
              <select value={curve} onChange={(e) => setCurve(e.target.value as Curve)}>
                {CURVES.map((c) => <option key={c} value={c}>{CURVE_META[c].label}</option>)}
              </select>
            </Field>
          </div>
          {!create && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ask before changes bigger than" hint="The weekly job applies smaller changes on its own.">
                <div className="flex items-center gap-2">
                  <input type="number" min={5} max={500} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                  <span className="text-sm text-muted">%</span>
                </div>
              </Field>
              <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this target, paid budget, constraints…" /></Field>
            </div>
          )}

          <SectionTitle title="Activities that drive it" hint="Share = how much of the growth the plan puts on each. Cap = the most that is realistic per week. Yields are benchmarks the goal re-learns from your results every week." />
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 pl-4 font-medium">Activity</th>
                  <th className="px-2 py-1 text-right font-medium">Plan</th>
                  <th className="px-1 py-1 text-right font-medium">Share</th>
                  <th className="px-1 py-1 text-right font-medium">Cap / wk</th>
                  <th className="py-1 pl-1 pr-4 text-right font-medium">Yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {drivers.map((d) => {
                  const a = activities[d.activityCode];
                  const ok = fits(a, platformIds, platform);
                  const units = plan?.units[d.activityCode] ?? 0;
                  const target = plan?.targets[d.activityCode];
                  return (
                    <tr key={d.activityCode} className={d.enabled ? "" : "opacity-50"}>
                      <td className="py-1.5 pl-4">
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="!mt-0.5 !w-auto" checked={d.enabled} disabled={!ok} onChange={(e) => setDriver(d.activityCode, { enabled: e.target.checked })} />
                          <span className="min-w-0">
                            <span className="block font-medium">{d.label}</span>
                            <span className="block text-[10px] text-muted">
                              <span className="font-mono">{d.activityCode}</span> {a?.title ?? "missing from the master list"}
                              {!ok && a && " · no channel on this activity's platforms"}
                            </span>
                          </span>
                        </label>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        {d.enabled && units > 0 ? (
                          <>
                            <span className="font-semibold">{units}</span><span className="text-muted"> {d.unitLabel}/wk</span>
                            {a && target !== undefined && <span className="block text-[10px] text-muted">checklist: {perPeriodText(target, a.frequency)}</span>}
                          </>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <input type="number" min={0} step={5} className="!w-14 !py-0.5 !text-right !text-xs" value={Math.round((d.share / shareTotal) * 100)}
                          disabled={!d.enabled} onChange={(e) => setDriver(d.activityCode, { share: Math.max(0, Number(e.target.value)) / 100 * shareTotal })} aria-label={`${d.label} share`} />
                        <span className="ml-0.5 text-muted">%</span>
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <input type="number" min={0} className="!w-14 !py-0.5 !text-right !text-xs" value={d.maxPerWeek} disabled={!d.enabled}
                          onChange={(e) => setDriver(d.activityCode, { maxPerWeek: Math.max(0, Number(e.target.value)) })} aria-label={`${d.label} weekly cap`} />
                      </td>
                      <td className="py-1.5 pl-1 pr-4 text-right" title={d.scale === "audience" ? `${d.yield} ${meta.noun} per ${singular(d.unitLabel)} per 1,000 audience` : `${d.yield} ${meta.noun} per ${singular(d.unitLabel)}`}>
                        <input type="number" min={0} step="any" className="!w-16 !py-0.5 !text-right !text-xs" value={Number(d.yield.toPrecision(3))} disabled={!d.enabled}
                          onChange={(e) => setDriver(d.activityCode, { yield: Math.max(0, Number(e.target.value)) })} aria-label={`${d.label} yield`} />
                        <span className="block text-[10px] text-muted">
                          {d.scale === "audience" ? `≈ ${compact(effectiveYield(d, planAudience))} each now` : `per ${singular(d.unitLabel)}`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={pending || !valid || !drivers.some((d) => d.enabled)} onClick={submit}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {create ? "Create goal and set the plan" : "Save and re-plan"}
            </Button>
            {!create && props.canReset && (
              <Button variant="ghost" disabled={pending} title="Back to the master template's activities and benchmarks, forgetting what was learned"
                onClick={() => { if (confirm("Reset the activities to the master template? What the goal learned is forgotten.")) start(async () => { try { await resetGoalDriversAction(props.goal.id); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }); }}>
                <RotateCcw className="size-4" /> Reset to master
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader icon={Sparkles} title="The plan" subtitle={valid ? `From ${compact(anchorValue)} to ${targetPhrase(metric, targetValue)} by ${deadline}` : "Fill in where you are, the target and the deadline."} />
          {plan && path ? (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                <Stat
                  label={meta.kind === "stock" ? "Growth needed" : "Monthly rate grows"}
                  value={growth !== null ? `+${(growth * 100).toFixed(1)}%` : `+${compact((targetValue - anchorValue) / Math.max(1, daysBetween(anchorDate, deadline) / 7))}`}
                  sub={growth !== null ? "a week" : meta.kind === "stock" ? `${meta.noun} a week` : "a month, every week"}
                />
                <Stat label="First 7 days" value={compact(plan.required)} sub={meta.noun} />
                <Stat label="Last week" value={compact(meta.kind === "stock" ? lastWeek : (targetValue * 7) / 30.44)} sub={meta.noun} />
                <Stat label="Work" value={`${plan.hoursPerWeek} h`} sub="a week, roughly" icon={Clock} />
              </div>
              {plan.feasible ? (
                <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Reachable within the weekly caps
                    {meta.kind === "stock"
                      ? plan.reachDate ? ` — at full capacity it would land around ${plan.reachDate}` : ""
                      : ` — full capacity can sustain about ${compact(plan.atDeadline)} ${meta.noun} a month`}
                    . The plan asks for less than the caps early on and steps up as needed.
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Not reachable with these activities, even at every weekly cap: full capacity gets to about <b>{compact(plan.atDeadline)}</b> by the deadline
                    {plan.reachDate ? <> and reaches the target around <b>{plan.reachDate}</b></> : ""}. Move the deadline, raise the caps, add activities or plan for paid promotion.
                    The goal still works — it will ask for full capacity and show the gap honestly.
                  </span>
                </p>
              )}
              {curve === "compound" && anchorValue <= 0 && (
                <p className="text-[11px] text-muted">Starting from zero, the plan grows in a straight line — a percentage of nothing is nothing.</p>
              )}
              <PlanChart points={chart} target={targetValue} height={180} unit={meta.kind === "flow" ? "/mo" : ""} planLabel="Plan" />
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted">The preview appears as soon as the numbers make sense: a target above today, at least a week away.</p>
          )}
        </Card>

        {plan && milestones.length > 0 && (
          <Card>
            <CardHeader title="Milestones" subtitle={meta.kind === "stock" ? "Where the plan expects to be at each month end." : "The monthly rate the plan expects by each month end."} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 text-xs 2xl:grid-cols-3">
              {milestones.map((m) => (
                <div key={m.date} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
                  <span className="text-muted">{label(m.date)}</span>
                  <span className="font-medium tabular-nums">{compact(m.value)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon?: typeof Clock }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <p className="flex items-center gap-1 text-[11px] text-muted">{Icon && <Icon className="size-3" />}{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
