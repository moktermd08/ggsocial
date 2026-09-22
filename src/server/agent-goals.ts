import "server-only";
import type { BrandWithRole } from "@/lib/auth";
import { METRIC_META, type GoalGrain } from "@/lib/goals/meta";
import { getGoalState, getRevisions, type Goal, type GoalState } from "@/server/goals";

/**
 * Goals as an agent sees them: plain numbers and words, no chart points.
 * Shared by the list and single-goal endpoints so both describe a goal the same way.
 */
export function goalView(goal: Goal, brand: BrandWithRole, s: GoalState) {
  const meta = METRIC_META[goal.metric];
  return {
    id: goal.id,
    brand: brand.slug,
    name: goal.name,
    metric: goal.metric,
    kind: meta.kind,
    unit: meta.kind === "stock" ? meta.noun : `${meta.noun} a month`,
    platform: goal.platform,
    status: goal.status,
    start: { date: goal.startDate, value: round(s.start) },
    target: { value: goal.targetValue, deadline: goal.deadline },
    now: s.now === null ? null : round(s.now),
    plannedNow: round(s.plannedNow),
    pace: s.pace,
    progressPct: Math.round(s.progress * 100),
    daysLeft: s.daysLeft,
    projectedHitDate: s.projection.date,
    latestReading: s.latestReading,
    feasible: goal.plan?.feasible ?? true,
    reachDateAtFullCapacity: goal.plan?.reachDate ?? null,
    hoursPerWeek: goal.plan?.hoursPerWeek ?? 0,
    thisWeek: {
      required: round(goal.plan?.required ?? 0),
      activities: s.drivers.filter((d) => d.enabled && d.weeklyPlanned > 0).map((d) => ({
        code: d.code,
        label: d.label,
        unit: d.unitLabel,
        perWeek: d.weeklyPlanned,
        checklistTarget: d.periodTarget,
        checklistFrequency: d.frequency,
        doneThisWeek: round(d.doneThisWeek, 1),
        expectedByNow: round(d.plannedThisWeekSoFar, 1),
        yieldPerUnit: round(d.perUnit, 2),
        benchmarkPerUnit: round(d.perUnitPrior, 2),
        shareOfPlanPct: Math.round(d.share * 100),
        missedLast4Weeks: round(d.lost4w),
        setByHand: d.manualTarget,
      })),
    },
    whereToImprove: s.insights,
  };
}

export async function goalDetail(goal: Goal, brand: BrandWithRole, grain: GoalGrain) {
  const [s, revisions] = await Promise.all([getGoalState(goal, brand, { grain }), getRevisions(goal.id, 10)]);
  return {
    ...goalView(goal, brand, s),
    periods: s.grains.map((g) => ({
      grain: g.grain, period: g.period.key, start: g.period.start, end: g.period.end,
      planned: round(g.planned), expectedByNow: round(g.expectedSoFar), actual: g.actual === null ? null : round(g.actual),
    })),
    history: {
      grain,
      periods: s.history.map((h) => ({
        period: h.period.key, start: h.period.start, end: h.period.end,
        planned: round(h.planned), actual: h.actual === null ? null : round(h.actual), beforeGoal: h.beforeStart,
      })),
    },
    revisions: revisions.map((r) => ({
      id: r.id, at: r.createdAt.toISOString(), kind: r.kind, status: r.status, summary: r.summary, reasons: r.reasons,
      perWeek: r.after.plan.units,
    })),
  };
}

function round(n: number, digits = 0) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
