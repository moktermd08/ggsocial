import type { Frequency } from "@/lib/activities/meta";
import type { Curve, GoalDriver, GoalPlan, MetricKind, Pace } from "./meta";

/*
 * The goal maths. Pure functions on "YYYY-MM-DD" strings, so the server, the
 * cron job and the live preview in the browser all get the same numbers.
 *
 * The model, in one paragraph: a goal draws a path from where the brand is to
 * where it wants to be. Each week the path says how much must be gained. That
 * gain is shared across drivers (activities) by their share of the plan,
 * tilted toward drivers that are out-performing their benchmark, and divided
 * by each driver's yield to get units of work — capped at what is realistic
 * per week, with the overflow handed to drivers that still have room. Every
 * week the yields are re-learned from what was actually done and gained.
 */

export const DAYS_PER_MONTH = 30.44;
const DAY = 86_400_000;

export const dayNum = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY);
export const fromDayNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => fromDayNum(dayNum(key) + n);
export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);

/* ----------------------------------------------------------------- paths */

/**
 * A stock path gives the level at the end of each day; a flow path gives the
 * monthly rate on each day. `anchor` is where the path starts: the goal's
 * start, or today's actual after a recalibration.
 */
export type GoalPath = {
  kind: MetricKind;
  curve: Curve;
  anchorDate: string;
  anchorValue: number;
  targetValue: number;
  deadline: string;
};

export function pathValue(p: GoalPath, date: string): number {
  const total = daysBetween(p.anchorDate, p.deadline);
  if (total <= 0) return p.targetValue;
  const t = Math.min(1, Math.max(0, daysBetween(p.anchorDate, date) / total));
  if (p.curve === "compound" && p.anchorValue > 0 && p.targetValue > 0) {
    return p.anchorValue * (p.targetValue / p.anchorValue) ** t;
  }
  return p.anchorValue + (p.targetValue - p.anchorValue) * t;
}

/** What the path asks for over [from, to], both days included. */
export function requiredBetween(p: GoalPath, from: string, to: string): number {
  if (p.kind === "stock") return pathValue(p, to) - pathValue(p, addDays(from, -1));
  let sum = 0;
  for (let d = dayNum(from), end = dayNum(to); d <= end; d++) sum += pathValue(p, fromDayNum(d)) / DAYS_PER_MONTH;
  return sum;
}

/** The weekly growth rate a compound stock path implies, e.g. 0.058 = +5.8% a week. */
export function weeklyGrowthRate(p: GoalPath) {
  const days = daysBetween(p.anchorDate, p.deadline);
  if (days <= 0 || p.anchorValue <= 0 || p.targetValue <= 0) return null;
  return (p.targetValue / p.anchorValue) ** (7 / days) - 1;
}

/* ------------------------------------------------------------ allocation */

/**
 * The smallest audience content is counted at. A brand-new account's posts
 * still reach people through search, hashtags and the feed, so at zero
 * followers a post is worth what it would be to about a thousand, not nothing.
 */
export const DISCOVERY_FLOOR = 1000;

/** Audience as audience-scaled yields see it: the real one, but never below the discovery floor. */
export const reachAudience = (audience: number) => Math.max(DISCOVERY_FLOOR, audience);

export function effectiveYield(d: Pick<GoalDriver, "yield" | "scale">, audience: number) {
  return d.scale === "audience" ? (d.yield * reachAudience(audience)) / 1000 : d.yield;
}

/**
 * How much weight a driver gets beyond its planned share. A driver yielding
 * four times its benchmark gets twice the weight; one yielding a quarter gets
 * half. Square-rooted and clamped so one lucky week cannot swing the plan.
 */
export function tilt(d: Pick<GoalDriver, "yield" | "priorYield">) {
  if (!(d.priorYield > 0) || !(d.yield > 0)) return 1;
  return Math.min(2, Math.max(0.5, Math.sqrt(d.yield / d.priorYield)));
}

export type AllocationRow = {
  code: string;
  /** Units of work per week, unrounded. */
  units: number;
  /** Metric the plan expects those units to bring. */
  gain: number;
  effectiveYield: number;
  /** Final share of the drivers' gain, after tilting and capping. */
  share: number;
  capped: boolean;
};

export type Allocation = {
  /** What the path asks for this week. */
  required: number;
  /** Expected without any of the work (organic drift). */
  baseline: number;
  rows: AllocationRow[];
  /** Gain no driver has room left to deliver, even at its cap. */
  shortfall: number;
};

export function allocate(opts: { required: number; drivers: GoalDriver[]; audience: number; baseline: number }): Allocation {
  const need = Math.max(0, opts.required - opts.baseline);
  const active = opts.drivers
    .map((d) => ({ d, ey: effectiveYield(d, opts.audience), w: Math.max(0, d.share) * tilt(d) }))
    .filter((x) => x.d.enabled && x.ey > 0 && x.d.maxPerWeek > 0);
  const allZero = active.every((x) => x.w === 0);
  for (const x of active) if (allZero) x.w = 1;

  const gain = new Map<string, number>();
  const capped = new Set<string>();
  let remaining = need;
  let open = active;
  // Hand the need out by weight; whatever a capped driver cannot carry goes round again.
  while (remaining > 1e-9 && open.length) {
    const total = open.reduce((s, x) => s + x.w, 0) || open.length;
    let spilled = 0;
    const next: typeof open = [];
    for (const x of open) {
      const g = (gain.get(x.d.activityCode) ?? 0) + remaining * ((x.w || 1) / total);
      const cap = x.d.maxPerWeek * x.ey;
      if (g >= cap - 1e-9) {
        gain.set(x.d.activityCode, cap);
        capped.add(x.d.activityCode);
        spilled += g - cap;
      } else {
        gain.set(x.d.activityCode, g);
        next.push(x);
      }
    }
    remaining = spilled;
    open = next;
  }

  const delivered = [...gain.values()].reduce((s, g) => s + g, 0);
  const rows = opts.drivers.map((d) => {
    const ey = effectiveYield(d, opts.audience);
    const g = gain.get(d.activityCode) ?? 0;
    return {
      code: d.activityCode,
      units: ey > 0 ? g / ey : 0,
      gain: g,
      effectiveYield: ey,
      share: delivered > 0 ? g / delivered : 0,
      capped: capped.has(d.activityCode),
    };
  });
  return { required: opts.required, baseline: opts.baseline, rows, shortfall: Math.max(0, remaining) };
}

/** Whole units per week: what a person is actually asked to do. */
export const weeklyUnits = (units: number) => (units <= 0 ? 0 : Math.ceil(units - 0.05));

/* ----------------------------------------------- activity period targets */

const PERIOD_DAYS: Record<Frequency, number> = {
  daily: 1, every_2_days: 2, weekly: 7, monthly: DAYS_PER_MONTH, quarterly: DAYS_PER_MONTH * 3,
  half_yearly: DAYS_PER_MONTH * 6, yearly: 365.25,
};

/**
 * A weekly volume as a target for an activity's own period: 21 comments a
 * week is 3 a day, 7 videos a week is 2 per two-day window. Rounded up, with
 * a tenth of a unit of slack so 1.04 launches a quarter stays 1.
 */
export function periodTarget(unitsPerWeek: number, frequency: Frequency) {
  if (unitsPerWeek <= 0) return 0;
  return Math.max(1, Math.ceil((unitsPerWeek * PERIOD_DAYS[frequency]) / 7 - 0.1));
}

/** The weekly volume an activity's period target amounts to. */
export function weeklyFromPeriod(target: number, frequency: Frequency) {
  return (target * 7) / PERIOD_DAYS[frequency];
}

/* ----------------------------------------------------------- feasibility */

export type Feasibility = {
  /** Whether the plan can reach the target by the deadline at full capacity. */
  feasible: boolean;
  /** Where full capacity gets to by the deadline (level, or monthly rate for flows). */
  atDeadline: number;
  /** When full capacity reaches the target, if it ever does within ten years. */
  reachDate: string | null;
};

/**
 * Runs the goal forward at every driver's weekly cap. For a stock, the
 * audience compounds, so audience-scaled drivers earn more each week.
 */
export function feasibility(opts: {
  kind: MetricKind; from: string; fromValue: number; target: number; deadline: string;
  drivers: GoalDriver[]; baseline: number; audience: number;
}): Feasibility {
  const active = opts.drivers.filter((d) => d.enabled && d.maxPerWeek > 0);
  const weekly = (aud: number) => opts.baseline + active.reduce((s, d) => s + d.maxPerWeek * effectiveYield(d, aud), 0);

  if (opts.kind === "flow") {
    const rate = weekly(opts.audience) * (DAYS_PER_MONTH / 7);
    return { feasible: rate >= opts.target, atDeadline: rate, reachDate: rate >= opts.target ? opts.from : null };
  }

  let level = opts.fromValue;
  let date = opts.from;
  let atDeadline: number | null = null;
  let reachDate: string | null = level >= opts.target ? date : null;
  for (let w = 0; w < 520 && (reachDate === null || atDeadline === null); w++) {
    const next = addDays(date, 7);
    const gained = weekly(level);
    if (gained <= 0 && reachDate === null) break;
    const after = level + gained;
    if (atDeadline === null && next >= opts.deadline) {
      const f = Math.min(1, Math.max(0, daysBetween(date, opts.deadline) / 7));
      atDeadline = level + gained * f;
    }
    if (reachDate === null && after >= opts.target) {
      reachDate = addDays(date, Math.max(0, Math.ceil(((opts.target - level) / gained) * 7)));
    }
    level = after;
    date = next;
  }
  atDeadline ??= level;
  return { feasible: reachDate !== null && reachDate <= opts.deadline, atDeadline, reachDate };
}

/* -------------------------------------------------------------- learning */

export type WeekObservation = {
  /** What the metric gained that week (a stock's change, or a flow's count). */
  gain: number;
  /** Audience at the start of the week, for audience-scaled drivers. */
  audience: number;
  /** Units of each driver's activity done that week, by activity code. */
  units: Record<string, number>;
};

export type Learned = {
  yields: Record<string, number>;
  baseline: number;
  weeksUsed: number;
};

/**
 * Re-estimates each driver's yield and the organic baseline from the weeks
 * observed. Each yield is modelled as its benchmark times a multiplier, and
 * every multiplier starts from the same belief — "probably somewhere between
 * a tenth and two and a half times the benchmark" — so the data has to earn
 * every move:
 *
 *   gain ≈ baseline + Σ multiplier × benchmark × units
 *
 * fitted as a Bayesian linear regression (ridge in multiplier space). With a
 * couple of weeks the benchmarks dominate; with a quarter of data, the
 * brand's own results do. A driver never done keeps its benchmark, and a
 * small driver cannot soak up a big driver's surprise, because moving any
 * multiplier costs the same. Multipliers stay within ÷10 and ×5.
 */
export function learnYields(opts: {
  weeks: WeekObservation[]; drivers: GoalDriver[]; baselinePrior: number;
  /** Assumed week-to-week noise, as a fraction of the average weekly gain. */
  noise?: number;
  /** Prior spread of each multiplier (1 = the benchmark). */
  spread?: number;
}): Learned {
  const drivers = opts.drivers;
  const weeks = opts.weeks;
  if (weeks.length < 2) {
    return { yields: Object.fromEntries(drivers.map((d) => [d.activityCode, d.yield])), baseline: opts.baselinePrior, weeksUsed: weeks.length };
  }
  const bench = drivers.map((d) => (d.priorYield > 0 ? d.priorYield : Math.max(d.yield, 1e-6)));
  const X = weeks.map((w) => [
    1,
    ...drivers.map((d, i) => bench[i] * (w.units[d.activityCode] ?? 0) * (d.scale === "audience" ? reachAudience(w.audience) / 1000 : 1)),
  ]);
  const y = weeks.map((w) => w.gain);
  const n = drivers.length + 1;

  const meanGain = y.reduce((s, v) => s + Math.abs(v), 0) / y.length;
  const sigmaE = Math.max(1, (opts.noise ?? 0.2) * meanGain);
  const spread = opts.spread ?? 0.8;
  // Precision of each prior relative to the noise: λ = σₑ² / σ_prior².
  const lambda = [sigmaE ** 2 / Math.max(1, 0.3 * meanGain) ** 2, ...drivers.map(() => sigmaE ** 2 / spread ** 2)];
  const prior = [opts.baselinePrior, ...drivers.map(() => 1)];

  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    X.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? lambda[i] : 0)));
  const b = Array.from({ length: n }, (_, i) => X.reduce((s, row, k) => s + row[i] * y[k], 0) + lambda[i] * prior[i]);
  const theta = solve(A, b) ?? prior;

  const yields: Record<string, number> = {};
  drivers.forEach((d, i) => { yields[d.activityCode] = bench[i] * Math.min(5, Math.max(0.1, theta[i + 1])); });
  const maxAbs = Math.max(1, ...y.map(Math.abs));
  return { yields, baseline: Math.min(maxAbs, Math.max(-maxAbs, theta[0])), weeksUsed: weeks.length };
}

/** Gaussian elimination with partial pivoting. Null when the system is singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/* ------------------------------------------------------------ actuals */

export type Point = { date: string; value: number };

/**
 * A level on any date from sparse readings: straight lines between readings,
 * flat after the last one. Null before the first reading.
 */
export function levelAt(points: Point[], date: string): number | null {
  if (points.length === 0 || date < points[0].date) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.date <= date) {
      const next = points[i + 1];
      if (!next) return p.value;
      const f = daysBetween(p.date, date) / Math.max(1, daysBetween(p.date, next.date));
      return p.value + (next.value - p.value) * f;
    }
  }
  return null;
}

/* ------------------------------------------------------------ projection */

/**
 * When the goal lands at the pace of the last four weeks: a compound rate for
 * a stock, the month-on-month trend for a flow. Null when the trend never
 * gets there (or there is not enough history to say).
 */
export function projectHit(opts: {
  kind: MetricKind; today: string; now: number; then: number | null; spanDays: number; target: number;
}): { rate: number | null; date: string | null } {
  if (opts.now >= opts.target) return { rate: null, date: opts.today };
  if (opts.then === null || opts.then <= 0 || opts.now <= 0 || opts.spanDays < 7) return { rate: null, date: null };
  const periodDays = opts.kind === "stock" ? 7 : DAYS_PER_MONTH;
  const rate = (opts.now / opts.then) ** (periodDays / opts.spanDays) - 1;
  if (rate <= 0) return { rate, date: null };
  const periods = Math.log(opts.target / opts.now) / Math.log(1 + rate);
  const days = periods * periodDays;
  return { rate, date: days > 3650 ? null : addDays(opts.today, Math.ceil(days)) };
}

/** Actual progress against planned progress, as a pace label. */
export function paceOf(actual: number | null, planned: number, start: number, kind: MetricKind): { pace: Pace; ratio: number | null } {
  if (actual === null) return { pace: "no_data", ratio: null };
  let ratio: number;
  if (kind === "stock") {
    const plannedGain = planned - start;
    // Too early for the plan to expect anything measurable: judge the level itself.
    ratio = plannedGain > Math.max(1, Math.abs(start) * 0.001) ? (actual - start) / plannedGain : actual >= planned ? 1 : actual / Math.max(1, planned);
  } else {
    ratio = planned > 0 ? actual / planned : 1;
  }
  const pace: Pace = ratio >= 1.05 ? "ahead" : ratio >= 0.9 ? "on_track" : ratio >= 0.7 ? "behind" : "at_risk";
  return { pace, ratio };
}

/* ------------------------------------------------------------- revisions */

/**
 * Whether a new plan moves any weekly volume far enough that a person should
 * look first: more than `thresholdPct` and at least two units.
 */
export function needsApproval(before: Record<string, number>, after: Record<string, number>, thresholdPct: number) {
  const codes = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const c of codes) {
    const a = before[c] ?? 0;
    const b = after[c] ?? 0;
    if (Math.abs(b - a) >= 2 && Math.abs(b - a) / Math.max(a, 1) > thresholdPct / 100) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ plan */

/** What the plan needs to know about each driver's activity in the master list. */
export type ActivityInfo = { frequency: Frequency; defaultTarget: number; minutesPerUnit: number };

/**
 * The whole plan for the next seven days from an anchor: what the path asks
 * for, who carries it, the checklist targets that follow, whether it is
 * reachable at all, and roughly how many hours it takes.
 *
 * Checklist targets only ever raise an activity above its master target: the
 * master list is the floor of good habits, the goal adds what the numbers need.
 */
export function buildPlan(opts: {
  kind: MetricKind; curve: Curve;
  anchorDate: string; anchorValue: number; targetValue: number; deadline: string;
  drivers: GoalDriver[]; baseline: number; audience: number;
  activities: Record<string, ActivityInfo | undefined>;
}): GoalPlan {
  const path: GoalPath = {
    kind: opts.kind, curve: opts.curve, anchorDate: opts.anchorDate, anchorValue: opts.anchorValue,
    targetValue: opts.targetValue, deadline: opts.deadline,
  };
  const start = addDays(opts.anchorDate, 1);
  const required = requiredBetween(path, start, addDays(start, 6));
  const alloc = allocate({ required, drivers: opts.drivers, audience: opts.audience, baseline: opts.baseline });
  const reach = feasibility({
    kind: opts.kind, from: opts.anchorDate, fromValue: opts.anchorValue, target: opts.targetValue, deadline: opts.deadline,
    drivers: opts.drivers, baseline: opts.baseline, audience: opts.audience,
  });

  const units: Record<string, number> = {};
  const gains: Record<string, number> = {};
  const targets: Record<string, number> = {};
  let minutes = 0;
  for (const row of alloc.rows) {
    if (row.units <= 0) continue;
    const info = opts.activities[row.code];
    // Daily and weekly work is asked for in whole units a week; a monthly or
    // quarterly activity keeps its fraction (0.3 a week = 2 a month, not 5).
    const u = !info || PERIOD_DAYS[info.frequency] <= 7 ? weeklyUnits(row.units) : Math.ceil(row.units * 10 - 0.5) / 10 || 0.1;
    units[row.code] = u;
    gains[row.code] = u * row.effectiveYield;
    if (!info) continue;
    targets[row.code] = Math.max(info.defaultTarget, periodTarget(row.units, info.frequency));
    minutes += u * info.minutesPerUnit;
  }

  return {
    anchorDate: opts.anchorDate, anchorValue: opts.anchorValue, weekStart: start, required, audience: opts.audience,
    units, gains, targets, shortfall: alloc.shortfall,
    feasible: reach.feasible, reachDate: reach.reachDate, atDeadline: reach.atDeadline,
    hoursPerWeek: Math.round((minutes / 60) * 10) / 10,
  };
}
