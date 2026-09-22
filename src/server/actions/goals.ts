"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, brandActivitySettings, channels, goalRevisions, goalTemplates, goals, memberships } from "@/lib/db";
import { requireUser, can, atLeast, type SessionUser } from "@/lib/auth";
import { CURVES, GOAL_METRICS, GOAL_STATUSES, METRIC_META, type Curve, type DriverSpec, type GoalDriver, type GoalMetric, type GoalStatus } from "@/lib/goals/meta";
import { addDays, daysBetween } from "@/lib/goals/engine";
import { isDateKey, todayIn } from "@/lib/activities/periods";
import { roleOn } from "@/server/activities";
import {
  activitiesByCode, applyActivityTargets, brandPlatforms, decideRevision, deleteSnapshot, driverFits, ensureGoalLibrary,
  flowDaily, pullAccountStats, recalibrateGoal, saveSnapshots, stockSeries, type SnapshotInput,
} from "@/server/goals";

function done(goalId?: string) {
  revalidatePath("/goals");
  if (goalId) revalidatePath(`/goals/${goalId}`);
  revalidatePath("/activities");
}

async function requireBrand(user: SessionUser, brandId: string, test: (r: NonNullable<Awaited<ReturnType<typeof roleOn>>>) => boolean, what: string) {
  const role = await roleOn(user.id, brandId);
  if (!role || !test(role)) throw new Error(`You need ${what} access to this brand.`);
  return role;
}

async function loadGoal(goalId: string) {
  const goal = await db.query.goals.findFirst({ where: eq(goals.id, goalId) });
  if (!goal) throw new Error("Goal not found.");
  return goal;
}

const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);

/* -------------------------------------------------------- where you stand */

/**
 * Today's value of a metric for a brand, to prefill a new goal: the latest
 * level for a stock, the last 28 days' monthly rate for a flow. Also the
 * brand's follower count, which audience-scaled yields are worked at.
 */
export async function goalStartingPointAction(input: { brandId: string; metric: GoalMetric; platform: string | null }) {
  return asResult(async () => {
    const user = await requireUser();
    await requireBrand(user, input.brandId, can.view, "view");
    if (!GOAL_METRICS.includes(input.metric)) throw new Error("Bad metric.");
    const brand = await db.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, input.brandId), columns: { id: true, name: true, timezone: true } });
    if (!brand) throw new Error("Brand not found.");
    const today = todayIn(brand.timezone);
    const followers = await stockSeries(brand.id, "followers", input.platform);
    let current: number | null;
    if (METRIC_META[input.metric].kind === "stock") {
      current = input.metric === "followers" ? followers.at(today) : (await stockSeries(brand.id, input.metric, input.platform)).at(today);
    } else {
      const daily = await flowDaily(brand, input.metric, input.platform, addDays(today, -28), addDays(today, -1));
      const total = [...daily.values()].reduce((s, n) => s + n, 0);
      current = Math.round((total * 30.44) / 28);
    }
    return { today, current, audience: followers.at(today), latestReading: followers.latest };
  });
}

/* ------------------------------------------------------------ brand goals */

export type DriverEdit = Pick<GoalDriver, "activityCode" | "enabled" | "share" | "maxPerWeek"> & { yield?: number };

export type GoalInput = {
  brandId: string;
  templateId: string;
  platform: string | null;
  name?: string;
  startValue: number;
  targetValue: number;
  deadline: string;
  curve: Curve;
  drivers?: DriverEdit[];
};

function validateNumbers(input: { startValue: number; targetValue: number; deadline: string; curve: Curve }, today: string) {
  if (!finite(input.startValue) || input.startValue < 0) throw new Error("Where you are now must be a number of zero or more.");
  if (!finite(input.targetValue) || input.targetValue <= 0) throw new Error("Set a target above zero.");
  if (input.targetValue <= input.startValue) throw new Error("The target has to be higher than where you are now.");
  if (!isDateKey(input.deadline)) throw new Error("Pick a deadline.");
  if (daysBetween(today, input.deadline) < 7) throw new Error("Give the goal at least a week.");
  if (!CURVES.includes(input.curve)) throw new Error("Bad curve.");
}

/** Brand-specific driver settings on top of the template's: switch, share, cap and (for experts) yield. */
function mergeDrivers(base: GoalDriver[], edits: DriverEdit[] | undefined) {
  if (!edits) return base;
  return base.map((d) => {
    const e = edits.find((x) => x.activityCode === d.activityCode);
    if (!e) return d;
    const y = finite(e.yield) && e.yield! > 0 ? e.yield! : d.yield;
    return {
      ...d,
      enabled: Boolean(e.enabled),
      share: finite(e.share) ? Math.max(0, e.share) : d.share,
      maxPerWeek: finite(e.maxPerWeek) ? Math.max(0, Math.round(e.maxPerWeek)) : d.maxPerWeek,
      // A yield typed by hand becomes the new benchmark: it is what the person believes.
      yield: y,
      priorYield: y !== d.yield ? y : d.priorYield,
    };
  });
}

export async function createGoalAction(input: GoalInput) {
  return asResult(async () => {
    const user = await requireUser();
    await requireBrand(user, input.brandId, can.manageBrand, "admin");
    await ensureGoalLibrary();
    const template = await db.query.goalTemplates.findFirst({ where: eq(goalTemplates.id, input.templateId) });
    if (!template || template.archivedAt) throw new Error("Pick a goal template.");
    const brand = await db.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, input.brandId), columns: { timezone: true } });
    const today = todayIn(brand?.timezone ?? "UTC");
    validateNumbers(input, today);

    const [byCode, platforms] = await Promise.all([activitiesByCode(template.drivers.map((d) => d.activityCode)), brandPlatforms(input.brandId)]);
    if (input.platform && !platforms.has(input.platform)) throw new Error("This brand has no channel on that platform.");
    const base: GoalDriver[] = template.drivers.map((d) => ({
      ...d, priorYield: d.yield, enabled: driverFits(byCode.get(d.activityCode), platforms, input.platform),
    }));
    const drivers = mergeDrivers(base, input.drivers);
    if (!drivers.some((d) => d.enabled)) throw new Error("Switch on at least one activity to drive this goal.");

    const [row] = await db.insert(goals).values({
      brandId: input.brandId, templateId: template.id, metric: template.metric,
      name: input.name?.trim() || template.name,
      platform: input.platform, curve: input.curve,
      startDate: today, startValue: input.startValue, targetValue: input.targetValue, deadline: input.deadline,
      drivers, createdBy: user.id,
    }).returning({ id: goals.id });
    await recalibrateGoal(row.id, { userId: user.id, kind: "initial" });
    done(row.id);
    return { id: row.id };
  });
}

export async function updateGoalAction(input: {
  goalId: string; name: string; targetValue: number; deadline: string; curve: Curve;
  approvalThreshold: number; notes: string | null; drivers: DriverEdit[];
}) {
  return asResult(async () => {
    const user = await requireUser();
    const goal = await loadGoal(input.goalId);
    await requireBrand(user, goal.brandId, can.manageBrand, "admin");
    const brand = await db.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, goal.brandId), columns: { timezone: true } });
    validateNumbers({ startValue: goal.startValue, targetValue: input.targetValue, deadline: input.deadline, curve: input.curve }, todayIn(brand?.timezone ?? "UTC"));
    const drivers = mergeDrivers(goal.drivers, input.drivers);
    if (!drivers.some((d) => d.enabled)) throw new Error("Switch on at least one activity to drive this goal.");
    await db.update(goals).set({
      name: input.name.trim() || goal.name,
      targetValue: input.targetValue, deadline: input.deadline, curve: input.curve,
      approvalThreshold: Math.min(500, Math.max(5, Math.round(input.approvalThreshold) || 30)),
      notes: input.notes?.trim() || null,
      drivers, updatedAt: new Date(),
    }).where(eq(goals.id, goal.id));
    // A person changed the goal: re-plan now and put it straight into force.
    await recalibrateGoal(goal.id, { userId: user.id, kind: "edit" });
    done(goal.id);
  });
}

/** Back to the master template's drivers and benchmarks, forgetting what was learned. */
export async function resetGoalDriversAction(goalId: string) {
  return asResult(async () => {
    const user = await requireUser();
    const goal = await loadGoal(goalId);
    await requireBrand(user, goal.brandId, can.manageBrand, "admin");
    const template = goal.templateId ? await db.query.goalTemplates.findFirst({ where: eq(goalTemplates.id, goal.templateId) }) : null;
    if (!template) throw new Error("This goal's template no longer exists.");
    const [byCode, platforms] = await Promise.all([activitiesByCode(template.drivers.map((d) => d.activityCode)), brandPlatforms(goal.brandId)]);
    const drivers: GoalDriver[] = template.drivers.map((d) => ({
      ...d, priorYield: d.yield, enabled: driverFits(byCode.get(d.activityCode), platforms, goal.platform),
    }));
    await db.update(goals).set({ drivers, baseline: 0, updatedAt: new Date() }).where(eq(goals.id, goal.id));
    await recalibrateGoal(goal.id, { userId: user.id, kind: "edit" });
    done(goal.id);
  });
}

export async function setGoalStatusAction(goalId: string, status: GoalStatus) {
  return asResult(async () => {
    const user = await requireUser();
    if (!GOAL_STATUSES.includes(status)) throw new Error("Bad status.");
    const goal = await loadGoal(goalId);
    await requireBrand(user, goal.brandId, can.manageBrand, "admin");
    await db.update(goals).set({ status, updatedAt: new Date() }).where(eq(goals.id, goal.id));
    if (status === "active") await recalibrateGoal(goal.id, { userId: user.id, kind: "edit" });
    else await applyActivityTargets(goal.brandId);
    done(goal.id);
  });
}

/** Runs the weekly learn-and-replan now. Big changes still wait for approval. */
export async function recalibrateGoalAction(goalId: string) {
  return asResult(async () => {
    const user = await requireUser();
    const goal = await loadGoal(goalId);
    await requireBrand(user, goal.brandId, can.edit, "editor");
    const rev = await recalibrateGoal(goal.id, { userId: user.id });
    done(goal.id);
    return { status: rev.status, summary: rev.summary };
  });
}

export async function decideRevisionAction(revisionId: string, approve: boolean) {
  return asResult(async () => {
    const user = await requireUser();
    const rev = await db.query.goalRevisions.findFirst({ where: eq(goalRevisions.id, revisionId), columns: { goalId: true } });
    if (!rev) throw new Error("Plan not found.");
    const goal = await loadGoal(rev.goalId);
    await requireBrand(user, goal.brandId, (r) => can.manageBrand(r) || can.approve(r), "admin or approver");
    await decideRevision(revisionId, approve, user.id);
    done(goal.id);
  });
}

/**
 * Gives an activity whose target was set by hand back to the goals, so the
 * plan can move it again.
 */
export async function handBackActivityAction(input: { brandId: string; activityCode: string; goalId?: string }) {
  return asResult(async () => {
    const user = await requireUser();
    await requireBrand(user, input.brandId, can.manageBrand, "admin");
    const t = (await activitiesByCode([input.activityCode])).get(input.activityCode);
    if (!t) throw new Error("No such activity.");
    await db.delete(brandActivitySettings).where(and(eq(brandActivitySettings.brandId, input.brandId), eq(brandActivitySettings.templateId, t.id)));
    await applyActivityTargets(input.brandId);
    done(input.goalId);
  });
}

/* -------------------------------------------------------------- numbers */

export async function logSnapshotsAction(entries: SnapshotInput[]) {
  return asResult(async () => {
    const user = await requireUser();
    const clean = entries.filter((e) => finite(e.value) && e.value >= 0);
    if (clean.some((e) => !isDateKey(e.date) || !GOAL_METRICS.includes(e.metric))) throw new Error("Bad reading.");
    const brandIds = [...new Set(clean.map((e) => e.brandId))];
    for (const id of brandIds) await requireBrand(user, id, can.edit, "editor");
    const channelIds = [...new Set(clean.flatMap((e) => (e.channelId ? [e.channelId] : [])))];
    const owned = channelIds.length
      ? await db.select({ id: channels.id, brandId: channels.brandId }).from(channels).where(inArray(channels.id, channelIds))
      : [];
    for (const e of clean) {
      if (e.channelId && owned.find((c) => c.id === e.channelId)?.brandId !== e.brandId) throw new Error("That channel belongs to another brand.");
    }
    const saved = await saveSnapshots(clean, "manual", user.id);
    done();
    return { saved };
  });
}

export async function deleteSnapshotAction(input: { brandId: string; channelId: string | null; metric: GoalMetric; date: string }) {
  return asResult(async () => {
    const user = await requireUser();
    await requireBrand(user, input.brandId, can.edit, "editor");
    await deleteSnapshot(input.brandId, input.channelId, input.metric, input.date);
    done();
  });
}

/** Reads follower counts from every live channel of these brands now. */
export async function pullStatsAction(brandIds: string[]) {
  return asResult(async () => {
    const user = await requireUser();
    const rows = brandIds.length
      ? await db.select({ brandId: memberships.brandId, role: memberships.role }).from(memberships)
          .where(and(eq(memberships.userId, user.id), inArray(memberships.brandId, brandIds)))
      : [];
    const allowed = rows.filter((r) => can.edit(r.role)).map((r) => r.brandId);
    if (allowed.length === 0) throw new Error("You need editor access to pull numbers.");
    const results = await pullAccountStats({ brandIds: allowed });
    done();
    return {
      pulled: results.filter((r) => r.followers !== undefined).length,
      errors: results.filter((r) => r.error).map((r) => `${r.handle}: ${r.error}`),
      checked: results.length,
    };
  });
}

/* ------------------------------------------------------ master templates */

/** Same rule as the master activity list: super admins and anyone who runs a brand. */
async function requireLibraryEditor() {
  const user = await requireUser();
  if (user.isSuperAdmin) return user;
  const rows = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, user.id));
  if (!rows.some((r) => atLeast(r.role, "admin"))) throw new Error("Only brand admins can change the master goal templates.");
  return user;
}

export async function saveGoalTemplateAction(input: {
  id?: string; metric: GoalMetric; name: string; description: string; drivers: DriverSpec[];
}) {
  return asResult(async () => {
    const user = await requireLibraryEditor();
    await ensureGoalLibrary();
    const name = input.name.trim();
    if (!name) throw new Error("Give the template a name.");
    if (!GOAL_METRICS.includes(input.metric)) throw new Error("Bad metric.");
    const byCode = await activitiesByCode(input.drivers.map((d) => d.activityCode));
    const drivers: DriverSpec[] = [];
    for (const d of input.drivers) {
      const code = d.activityCode.trim().toUpperCase();
      if (!code) continue;
      if (!byCode.has(code)) throw new Error(`There is no activity ${code} in the master list.`);
      if (drivers.some((x) => x.activityCode === code)) throw new Error(`${code} is listed twice.`);
      if (!(d.yield > 0)) throw new Error(`${code}: the yield has to be above zero.`);
      drivers.push({
        activityCode: code,
        label: d.label.trim() || byCode.get(code)!.title,
        unitLabel: d.unitLabel.trim() || "units",
        yield: d.yield,
        scale: d.scale === "audience" ? "audience" : "fixed",
        share: Math.max(0, d.share || 0),
        maxPerWeek: Math.max(1, Math.round(d.maxPerWeek) || 1),
      });
    }
    if (drivers.length === 0) throw new Error("Add at least one activity that drives this goal.");
    // Shares are proportions: normalise so they always add up to 1.
    const total = drivers.reduce((s, d) => s + d.share, 0) || drivers.length;
    for (const d of drivers) d.share = Math.round(((d.share || (total === drivers.length ? 1 : 0)) / total) * 1000) / 1000;

    const values = { metric: input.metric, name, description: input.description.trim(), drivers, updatedAt: new Date() };
    if (input.id) {
      await db.update(goalTemplates).set(values).where(eq(goalTemplates.id, input.id));
    } else {
      await db.insert(goalTemplates).values({ ...values, code: `G-C-${Date.now().toString(36).toUpperCase()}`, isCustom: true, sortOrder: 100_000, createdBy: user.id });
    }
    done();
  });
}

export async function archiveGoalTemplateAction(templateId: string, archived: boolean) {
  return asResult(async () => {
    await requireLibraryEditor();
    await db.update(goalTemplates).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(goalTemplates.id, templateId));
    done();
  });
}
