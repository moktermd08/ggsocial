import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, CheckCircle2, Goal as GoalIcon, History, Info, Lightbulb,
  ListChecks, Settings2, ShieldCheck, TrendingUp, XCircle,
} from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { platformOrNull } from "@/lib/platforms";
import { FREQUENCY_META } from "@/lib/activities/meta";
import {
  GOAL_GRAINS, PACE_META, compact, perPeriodText, targetPhrase, type GoalGrain,
} from "@/lib/goals/meta";
import { weeklyGrowthRate } from "@/lib/goals/engine";
import { activitiesByCode, activityInfo, brandPlatforms, getGoal, getGoalState, getRevisions, type Insight } from "@/server/goals";
import { Badge, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { PlanBars, PlanChart, Ring } from "@/components/charts";
import { PlatformIcon } from "@/components/platform-icon";
import { GoalControls, HandBackButton, RevisionDecision } from "@/components/goal-controls";
import { GoalForm, type FormActivity } from "@/components/goal-form";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d: string, year = true) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${year ? ` ${d.slice(2, 4)}` : ""}`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const per = (n: number) => (n >= 10 ? n0(n) : n >= 1 ? n.toFixed(1) : n.toFixed(2));
/** Units done: whole where whole, one decimal where a tick was spread over days. */
const units = (n: number) => (Number.isInteger(n) ? String(n) : n >= 10 ? n0(n) : n.toFixed(1));

const GRAIN_LABEL: Record<GoalGrain, { now: string; tab: string }> = {
  daily: { now: "Today", tab: "Days" },
  weekly: { now: "This week", tab: "Weeks" },
  monthly: { now: "This month", tab: "Months" },
  quarterly: { now: "This quarter", tab: "Quarters" },
  yearly: { now: "This year", tab: "Years" },
};

const tone = (ratio: number | null) =>
  ratio === null ? "var(--muted)" : ratio >= 1 ? "var(--ok)" : ratio >= 0.7 ? "var(--warn)" : "var(--danger)";

const INSIGHT_ICON: Record<Insight["tone"], { icon: typeof Info; cls: string }> = {
  good: { icon: CheckCircle2, cls: "text-ok" },
  warn: { icon: AlertTriangle, cls: "text-warn" },
  bad: { icon: XCircle, cls: "text-danger" },
  info: { icon: Info, cls: "text-accent" },
};

export default async function GoalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ g?: string }> }) {
  const { id } = await params;
  const { g } = await searchParams;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const goal = await getGoal(id);
  if (!goal) notFound();
  const brand = brands.find((b) => b.id === goal.brandId);
  if (!brand) notFound();

  const grain: GoalGrain = GOAL_GRAINS.includes(g as GoalGrain) ? (g as GoalGrain) : "weekly";
  const [s, revisions, byCode, platforms] = await Promise.all([
    getGoalState(goal, brand, { grain }),
    getRevisions(goal.id),
    activitiesByCode(goal.drivers.map((d) => d.activityCode)),
    brandPlatforms(goal.brandId),
  ]);
  const canManage = can.manageBrand(brand.role);
  const canDecide = canManage || can.approve(brand.role);
  const platform = goal.platform ? platformOrNull(goal.platform) : null;
  const pace = PACE_META[s.pace];
  const proposed = revisions.find((r) => r.status === "proposed");
  const unit = s.kind === "flow" ? `${s.meta.noun} a month` : s.meta.noun;
  const growth = weeklyGrowthRate(s.current);
  const gap = goal.targetValue - s.start;
  const plannedShare = gap > 0 ? Math.max(0, Math.min(1, (s.plannedNow - s.start) / gap)) : 0;
  const drivers = s.drivers.filter((d) => d.enabled).sort((a, b) => b.share - a.share || b.lost4w - a.lost4w);
  const offDrivers = s.drivers.filter((d) => !d.enabled);
  const activities: Record<string, FormActivity> = {};
  for (const [code, t] of byCode) activities[code] = { ...activityInfo(t), title: t.title, platforms: t.platforms };

  return (
    <>
      <PageHeader
        icon={GoalIcon}
        title={goal.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: brand.color }} />{brand.name}</span>
            <span aria-hidden>·</span>
            {platform ? <span className="inline-flex items-center gap-1"><PlatformIcon platform={platform.id} size={13} />{platform.name}</span> : <span>All platforms</span>}
            <span aria-hidden>·</span>
            <span>{targetPhrase(goal.metric, goal.targetValue)} by {goal.deadline}</span>
            {goal.status !== "active" && <Badge>{goal.status}</Badge>}
          </span>
        }
        action={<GoalControls goalId={goal.id} status={goal.status} canManage={canManage} canRecalibrate={can.edit(brand.role)} />}
      />
      <p className="-mt-3 mb-4 text-xs"><Link href="/goals" className="text-muted hover:text-accent">← All goals</Link></p>

      {/* ------------------------------------------------ where it stands */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <Card className="flex items-center gap-4 p-4">
          <Ring value={s.progress * 100} total={100} size={84} color={pace.color}>
            <span className="text-sm">{Math.round(s.progress * 100)}%</span>
          </Ring>
          <div className="min-w-0">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{s.now === null ? "—" : compact(s.now)}<span className="text-sm font-normal text-muted"> / {compact(goal.targetValue)}</span></p>
            <p className="text-xs text-muted">{unit} · started at {compact(s.start)} on {day(goal.startDate)}</p>
            <p className="mt-1.5"><Badge color={pace.color}>{pace.label}</Badge>
              {s.ratio !== null && <span className="ml-1.5 text-xs text-muted">{Math.round(s.ratio * 100)}% of planned progress</span>}
            </p>
          </div>
        </Card>
        <Tile label="Plan expects today" value={compact(s.plannedNow)} hint={`${Math.round(plannedShare * 100)}% of the way · ${s.now !== null ? `${s.now >= s.plannedNow ? "+" : ""}${compact(s.now - s.plannedNow)} vs plan` : "no numbers yet"}`} icon={TrendingUp} color={pace.color} />
        <Tile
          label="At the last 4 weeks' pace"
          value={s.projection.date ? day(s.projection.date) : "—"}
          hint={s.projection.date ? (s.projection.date <= goal.deadline ? "lands before the deadline" : `${Math.round((Date.parse(s.projection.date) - Date.parse(goal.deadline)) / 86_400_000)} days late`) : s.now === null ? "log numbers to project" : "not on course to land — see below"}
          icon={CalendarClock}
          color={s.projection.date && s.projection.date <= goal.deadline ? "var(--ok)" : "var(--warn)"}
        />
        <Tile
          label="Time left"
          value={`${s.daysLeft} days`}
          hint={growth !== null ? `needs +${(growth * 100).toFixed(1)}% a week from here` : `${Math.round(s.elapsedShare * 100)}% of the time gone`}
          icon={CalendarClock}
          color="var(--accent)"
        />
      </div>

      {/* ---------------------------------------------- waiting for approval */}
      {proposed && (
        <Card className="mb-4 border-accent/50">
          <CardHeader icon={ShieldCheck} title="A new plan is waiting for approval" subtitle={`${proposed.summary} Proposed ${day(proposed.createdAt.toISOString().slice(0, 10))} by ${proposed.createdBy ? "a teammate" : "the weekly check"}.`} />
          <div className="space-y-3 p-4">
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{proposed.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="pr-6 font-medium">Activity</th><th className="pr-4 text-right font-medium">Now / wk</th><th className="text-right font-medium">Proposed / wk</th></tr></thead>
                <tbody>
                  {goal.drivers.filter((d) => (proposed.before?.plan?.units[d.activityCode] ?? 0) !== (proposed.after.plan.units[d.activityCode] ?? 0)).map((d) => {
                    const was = proposed.before?.plan?.units[d.activityCode] ?? 0;
                    const now = proposed.after.plan.units[d.activityCode] ?? 0;
                    return (
                      <tr key={d.activityCode}>
                        <td className="py-0.5 pr-6">{d.label}</td>
                        <td className="py-0.5 pr-4 text-right tabular-nums text-muted">{was}</td>
                        <td className={`py-0.5 text-right font-semibold tabular-nums ${now > was ? "text-warn" : "text-ok"}`}>{now}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canDecide ? <RevisionDecision revisionId={proposed.id} /> : <p className="text-xs text-muted">A brand admin or approver can approve it.</p>}
          </div>
        </Card>
      )}

      {/* ---------------------------------------------- chart + what to do */}
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={TrendingUp} title="Plan against actual"
            subtitle={s.kind === "stock" ? "The level over time. The plan in force restarts from the actual at each recalibration, spreading any gap over the time left." : "Monthly rate over time (rolling 28 days)."} />
          <div className="p-4">
            <PlanChart
              target={goal.targetValue}
              today={s.today}
              unit={s.kind === "flow" ? "/mo" : ""}
              points={s.chart.map((p) => ({ ...p, label: day(p.date) }))}
            />
          </div>
        </Card>
        <Card>
          <CardHeader icon={Lightbulb} title="Where to improve" subtitle="Worked out from the plan, what was ticked off, and what the numbers did." />
          <ul className="space-y-3 p-4">
            {s.insights.length === 0 && <li className="text-sm text-muted">Nothing to flag yet.</li>}
            {s.insights.map((i, k) => {
              const { icon: Icon, cls } = INSIGHT_ICON[i.tone];
              return <li key={k} className="flex gap-2 text-sm"><Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} /><span>{i.text}</span></li>;
            })}
          </ul>
        </Card>
      </div>

      {/* ------------------------------------ day / week / month / quarter / year */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {s.grains.map((r) => {
          const ratio = r.actual === null ? null : r.expectedSoFar > 0 ? r.actual / r.expectedSoFar : r.actual >= 0 ? 1 : 0;
          const width = r.planned > 0 && r.actual !== null ? Math.max(0, Math.min(100, (r.actual / r.planned) * 100)) : 0;
          const marker = r.planned > 0 ? Math.min(100, (r.expectedSoFar / r.planned) * 100) : 0;
          return (
            <Link key={r.grain} href={`/goals/${goal.id}?g=${r.grain}`}
              className={`block rounded-xl border bg-surface p-3 transition-colors hover:bg-surface-2 ${grain === r.grain ? "border-accent/60" : "border-border"}`}>
              <p className="flex items-center justify-between text-xs text-muted">
                <span className="font-medium text-text">{GRAIN_LABEL[r.grain].now}</span>
                <span>{r.period.short}</span>
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums" style={{ color: tone(ratio) }}>
                {r.actual === null ? "—" : `${r.actual >= 0 ? "+" : ""}${compact(r.actual)}`}
              </p>
              <p className="text-[11px] text-muted">{r.planned > 0 ? `of ${compact(r.planned)} planned${s.kind === "stock" ? " gain" : ""}` : "nothing planned yet — the plan starts tomorrow"}</p>
              <div className="relative mt-2 h-2 rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: tone(ratio) }} />
                {r.elapsed < 1 && <span className="absolute -top-0.5 h-3 w-0.5 rounded bg-text/60" style={{ left: `${marker}%` }} title={`Expected by now: ${n0(r.expectedSoFar)}`} />}
              </div>
              <p className="mt-1 text-[10px] text-muted">
                {r.elapsed < 1 ? `expected by now ${compact(r.expectedSoFar)} · ${Math.round(r.elapsed * 100)}% gone` : "complete"}
              </p>
            </Link>
          );
        })}
      </div>

      {/* ------------------------------------------------- the weekly plan */}
      <Card className="mb-4 overflow-hidden">
        <CardHeader
          icon={ListChecks}
          title="This week's plan, activity by activity"
          subtitle={goal.plan
            ? `The next 7 days need ${n0(goal.plan.required)} ${s.meta.noun}${s.kind === "flow" ? "" : " gained"}. These volumes are the brand's activity checklist targets — about ${goal.plan.hoursPerWeek} h of work a week. "Each brings" is learned from results and shown against the benchmark.`
            : "No plan yet."}
          action={<LinkButton href="/activities" size="sm">Open checklists</LinkButton>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Activity</th>
                <th className="px-3 py-2 text-right font-medium">Plan / week</th>
                <th className="w-44 px-3 py-2 font-medium">Done this week</th>
                <th className="px-3 py-2 text-right font-medium">Last 4 weeks</th>
                <th className="px-3 py-2 text-right font-medium">Each brings</th>
                <th className="w-32 px-3 py-2 font-medium">Share of plan</th>
                <th className="px-4 py-2 text-right font-medium">Missed (4 wk)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {drivers.map((d) => {
                // Daily work can be judged day by day; a weekly or monthly task can land any day, so it stays neutral until it is done.
                const paced = d.frequency === "daily" || d.frequency === "every_2_days";
                const doneRatio = d.doneThisWeek >= d.weeklyPlanned && d.weeklyPlanned > 0 ? 1
                  : paced && d.plannedThisWeekSoFar > 0 ? d.doneThisWeek / d.plannedThisWeekSoFar : null;
                const fourRatio = d.planned4w > 0 ? d.done4w / d.planned4w : null;
                return (
                  <tr key={d.code} className="align-top hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{d.label}</p>
                      <p className="text-[11px] text-muted"><span className="font-mono">{d.code}</span> {d.activityTitle}</p>
                      {d.manualTarget !== null && d.periodTarget !== null && d.manualTarget < d.periodTarget && (
                        <p className="mt-1 flex items-center gap-2 text-[11px] text-warn">
                          Set by hand to {d.manualTarget}; the goal needs {d.periodTarget}.
                          {canManage && <HandBackButton brandId={brand.id} activityCode={d.code} goalId={goal.id} />}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className="text-base font-semibold">{units(d.weeklyPlanned)}</span> <span className="text-xs text-muted">{d.unitLabel}</span>
                      {d.periodTarget !== null && d.frequency && d.frequency !== "weekly" && (
                        <p className="text-[11px] text-muted">= {perPeriodText(d.periodTarget, d.frequency)}</p>
                      )}
                      {d.capped && <p className="text-[11px] text-warn">at the weekly cap</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-between text-xs tabular-nums">
                        <span style={{ color: tone(doneRatio) }} className="font-semibold">{units(d.doneThisWeek)}</span>
                        <span className="text-muted">of {units(d.weeklyPlanned)}</span>
                      </div>
                      <div className="relative mt-1 h-1.5 rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${d.weeklyPlanned ? Math.min(100, (d.doneThisWeek / d.weeklyPlanned) * 100) : 0}%`, background: tone(doneRatio) }} />
                        <span className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-text/60" style={{ left: `${d.weeklyPlanned ? Math.min(100, (d.plannedThisWeekSoFar / d.weeklyPlanned) * 100) : 0}%` }} title="Where you should be by today" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      <span className="font-semibold" style={{ color: tone(fourRatio) }}>{units(Math.round(d.done4w * 10) / 10)}</span>
                      {d.planned4w > 0 ? <span className="text-muted"> / {units(Math.round(d.planned4w * 10) / 10)}</span> : <p className="text-[11px] text-muted">done · no plan yet</p>}
                      {fourRatio !== null && <p className="text-[11px] text-muted">{Math.round(fourRatio * 100)}% done</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      <span className="font-semibold">{per(d.perUnit)}</span> <span className="text-muted">{s.meta.noun}</span>
                      {Math.abs(d.yieldChange) >= 0.05 ? (
                        <p className={`inline-flex items-center gap-0.5 text-[11px] ${d.yieldChange > 0 ? "text-ok" : "text-danger"}`}>
                          {d.yieldChange > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                          {Math.round(Math.abs(d.yieldChange) * 100)}% vs benchmark {per(d.perUnitPrior)}
                        </p>
                      ) : <p className="text-[11px] text-muted">benchmark</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 text-xs tabular-nums">
                        <div className="h-1.5 flex-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.round(d.share * 100)}%` }} /></div>
                        <span className="w-8 text-right">{Math.round(d.share * 100)}%</span>
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 text-right text-xs tabular-nums ${d.lost4w > 0 ? "font-semibold text-danger" : "text-muted"}`}>
                      {d.lost4w > 0 ? `−${compact(d.lost4w)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {offDrivers.length > 0 && (
          <p className="border-t border-border px-4 py-2 text-[11px] text-muted">Switched off: {offDrivers.map((d) => d.label).join(", ")}.</p>
        )}
      </Card>

      {/* ------------------------------------------------------ history */}
      <Card className="mb-4">
        <CardHeader
          icon={History}
          title={`${GRAIN_LABEL[grain].tab}: planned against actual`}
          subtitle={`${s.kind === "stock" ? "Gain" : "Count"} per ${FREQUENCY_META[grain].noun}. Dashed = planned, solid = actual (green at or over plan, amber from 70%, red below).`}
          action={
            <div className="flex gap-1">
              {GOAL_GRAINS.map((x) => (
                <Link key={x} href={`/goals/${goal.id}?g=${x}`}
                  className={`rounded-md px-2 py-1 text-xs ${grain === x ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2"}`}>
                  {GRAIN_LABEL[x].tab}
                </Link>
              ))}
            </div>
          }
        />
        <div className="p-4">
          <PlanBars rows={s.history.map((h) => ({ key: h.period.key, label: h.period.short, tip: h.beforeStart ? `${h.period.label} (before the goal)` : h.period.label, planned: h.planned, actual: h.actual, current: h.current }))} />
        </div>
      </Card>

      {/* ---------------------------------------------------- revisions */}
      <Card className="mb-4">
        <CardHeader icon={History} title="How the plan has changed" subtitle="Every Monday the goal learns from the week's results and re-plans. Changes bigger than the approval threshold wait for a person." />
        <ol className="divide-y divide-border">
          {revisions.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-muted">{day(r.createdAt.toISOString().slice(0, 10))}</span>
                  <Badge color={r.status === "applied" ? "#15803d" : r.status === "proposed" ? "#4f46e5" : "#64748b"}>{r.status}</Badge>
                  <span className="text-xs text-muted">{r.kind === "initial" ? "first plan" : r.kind === "edit" ? "goal edited" : r.createdBy ? "recalibrated by hand" : "weekly check"}</span>
                  <span className="min-w-0 flex-1">{r.summary}</span>
                </summary>
                <div className="mt-2 pl-22 text-xs text-muted">
                  {r.reasons.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                  <p className="mt-2">
                    Weekly plan: {goal.drivers.filter((d) => r.after.plan.units[d.activityCode]).map((d) => `${r.after.plan.units[d.activityCode]} ${d.unitLabel}`).join(" · ") || "nothing"}
                    {" "}· ~{r.after.plan.hoursPerWeek} h/week
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </Card>

      {/* ----------------------------------------------------- settings */}
      {canManage && (
        <details className="group mb-4">
          <summary className="mb-3 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
            <Settings2 className="size-4 text-muted" /> Edit target, deadline and activities
            <span className="text-xs font-normal text-muted group-open:hidden">(opens the planner)</span>
          </summary>
          <GoalForm
            mode="edit"
            activities={activities}
            brandPlatforms={[...platforms]}
            canReset={Boolean(goal.templateId)}
            goal={{
              id: goal.id, brandId: goal.brandId, metric: goal.metric, name: goal.name, platform: goal.platform, platformName: platform?.name ?? null,
              startValue: s.start, startDate: goal.startDate, targetValue: goal.targetValue, deadline: goal.deadline, curve: goal.curve,
              approvalThreshold: goal.approvalThreshold, notes: goal.notes, drivers: goal.drivers, baseline: goal.baseline,
              nowDate: s.now !== null ? s.today : goal.plan?.anchorDate ?? goal.startDate,
              nowValue: s.now ?? goal.plan?.anchorValue ?? goal.startValue,
              audience: s.audience,
            }}
          />
        </details>
      )}
    </>
  );
}

function Tile({ label, value, hint, icon: Icon, color }: { label: string; value: string; hint: string; icon: typeof Info; color: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted"><Icon className="size-3.5" style={{ color }} />{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
    </Card>
  );
}
