import "server-only";
import crypto from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  db, activityTemplates, activityChecks, brandActivitySettings, agentTokens, channels, memberships, users,
  type Role,
} from "@/lib/db";
import { ACTIVITY_LIBRARY } from "@/lib/activities/library";
import {
  FREQUENCIES, type ActorKind, type CellStatus, type CheckStatus, type Frequency, type ReviewStatus,
} from "@/lib/activities/meta";
import { periodFor, periodPhase, recentPeriods, type Period } from "@/lib/activities/periods";

export type ActivityTemplate = typeof activityTemplates.$inferSelect;
export type ActivityCheck = typeof activityChecks.$inferSelect;

/* ------------------------------------------------------------- the library */

let seeding: Promise<void> | null = null;

/**
 * Makes sure every activity in the built-in library has a row. Inserts only
 * missing codes, so edits and retirements made in the app are never undone,
 * and new library entries arrive on the next deploy without a manual step.
 */
export function ensureActivityLibrary() {
  seeding ??= db.insert(activityTemplates)
    .values(ACTIVITY_LIBRARY.map((a, i) => ({
      code: a.code, title: a.title, description: a.description, category: a.category,
      frequency: a.frequency, platforms: a.platforms, target: a.target, unit: a.unit,
      proof: a.proof, performer: a.performer, leadImpact: a.leadImpact, estMinutes: a.minutes,
      sortOrder: (i + 1) * 10,
    })))
    .onConflictDoNothing({ target: activityTemplates.code })
    .then(() => undefined)
    .catch((e) => {
      seeding = null;
      throw e;
    });
  return seeding;
}

export async function getActivityTemplates(opts: { includeArchived?: boolean; frequency?: Frequency } = {}) {
  await ensureActivityLibrary();
  const where = [];
  if (!opts.includeArchived) where.push(isNull(activityTemplates.archivedAt));
  if (opts.frequency) where.push(eq(activityTemplates.frequency, opts.frequency));
  return db.select().from(activityTemplates)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(activityTemplates.sortOrder), asc(activityTemplates.code));
}

/* --------------------------------------------------- brand action plans */

export type PlanBrand = { id: string; name: string; color: string; timezone: string };

type BrandPlanContext = {
  platforms: Map<string, Set<string>>;
  settings: Map<string, typeof brandActivitySettings.$inferSelect>;
};

async function loadPlanContext(brandIds: string[]): Promise<BrandPlanContext> {
  if (brandIds.length === 0) return { platforms: new Map(), settings: new Map() };
  const [channelRows, settingRows] = await Promise.all([
    db.select({ brandId: channels.brandId, platform: channels.platform }).from(channels)
      .where(and(inArray(channels.brandId, brandIds), isNull(channels.archivedAt))),
    db.select().from(brandActivitySettings).where(inArray(brandActivitySettings.brandId, brandIds)),
  ]);
  const platforms = new Map<string, Set<string>>();
  for (const c of channelRows) {
    if (!platforms.has(c.brandId)) platforms.set(c.brandId, new Set());
    platforms.get(c.brandId)!.add(c.platform);
  }
  return { platforms, settings: new Map(settingRows.map((s) => [`${s.brandId}:${s.templateId}`, s])) };
}

/**
 * Whether an activity is on a brand's plan, and at what target. A brand-level
 * switch wins; otherwise general activities always apply and platform-specific
 * ones apply where the brand has a channel on one of those platforms.
 */
function planFor(ctx: BrandPlanContext, brandId: string, t: ActivityTemplate) {
  const setting = ctx.settings.get(`${brandId}:${t.id}`);
  const onPlatform = t.platforms.length === 0 || t.platforms.some((p) => ctx.platforms.get(brandId)?.has(p));
  return {
    applies: setting?.enabled ?? onPlatform,
    byDefault: onPlatform,
    override: setting?.enabled ?? null,
    target: setting?.target ?? t.target,
  };
}

/* ------------------------------------------------------------- checklist */

export type ChecklistCell = {
  brandId: string;
  applies: boolean;
  target: number;
  status: CellStatus;
  check: ActivityCheck | null;
  doneByUser: string | null;
  reviewedByUser: string | null;
};

export type ChecklistRow = { template: ActivityTemplate; cells: ChecklistCell[] };

async function userNames(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The day an activity joined the plan. Periods that ended before it cannot have been missed. */
const since = (t: ActivityTemplate) => t.createdAt.toISOString().slice(0, 10);

function cellStatus(check: { status: CheckStatus } | null, period: Period, phase: "past" | "current" | "future", t: ActivityTemplate): CellStatus {
  if (check) return check.status;
  return phase === "past" && period.end >= since(t) ? "missed" : "open";
}

/** One frequency's checklist for one period, across the given brands. */
export async function getChecklist(opts: { brands: PlanBrand[]; frequency: Frequency; date: string; today: string }) {
  const period = periodFor(opts.frequency, opts.date);
  const phase = periodPhase(period, opts.today);
  const brandIds = opts.brands.map((b) => b.id);

  const [templates, ctx, checks] = await Promise.all([
    getActivityTemplates({ frequency: opts.frequency }),
    loadPlanContext(brandIds),
    brandIds.length
      ? db.select().from(activityChecks)
          .where(and(inArray(activityChecks.brandId, brandIds), eq(activityChecks.periodKey, period.key)))
      : Promise.resolve([] as ActivityCheck[]),
  ]);

  const checkBy = new Map(checks.map((c) => [`${c.brandId}:${c.templateId}`, c]));
  const names = await userNames(checks.flatMap((c) => [c.doneByUserId, c.reviewedByUserId]));

  const rows: ChecklistRow[] = templates.map((template) => ({
    template,
    cells: opts.brands.map((b) => {
      const plan = planFor(ctx, b.id, template);
      const check = checkBy.get(`${b.id}:${template.id}`) ?? null;
      return {
        brandId: b.id,
        applies: plan.applies,
        target: plan.target,
        status: cellStatus(check, period, phase, template),
        check,
        doneByUser: check?.doneByUserId ? names.get(check.doneByUserId) ?? null : null,
        reviewedByUser: check?.reviewedByUserId ? names.get(check.reviewedByUserId) ?? null : null,
      };
    }),
  }));

  // Activities no brand in view has on its plan are noise in a checklist.
  return { period, phase, rows: rows.filter((r) => r.cells.some((c) => c.applies || c.check)) };
}

/** Completion for a set of cells: done = 1, partly = ½, skipped leaves the denominator. */
export function completion(cells: { applies: boolean; status: CellStatus }[]) {
  const counted = cells.filter((c) => c.applies && c.status !== "skipped");
  const score = counted.reduce((s, c) => s + (c.status === "done" ? 1 : c.status === "partial" ? 0.5 : 0), 0);
  return { total: counted.length, score, pct: counted.length ? Math.round((score / counted.length) * 100) : 0 };
}

/* ------------------------------------------------------------ recording */

export type Actor = { kind: ActorKind; name: string | null; userId: string | null };

export async function roleOn(userId: string, brandId: string): Promise<Role | null> {
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.brandId, brandId)),
    columns: { role: true },
  });
  return m?.role ?? null;
}

type Ref = { brandId: string; templateId?: string; code?: string; date: string };

/**
 * Resolves each ref to its activity and period in one query, so ticking a
 * whole checklist for four brands costs a handful of queries, not hundreds.
 */
async function resolve<T extends Ref>(refs: T[]) {
  await ensureActivityLibrary();
  const ids = [...new Set(refs.flatMap((r) => (r.templateId ? [r.templateId] : [])))];
  const codes = [...new Set(refs.flatMap((r) => (!r.templateId && r.code ? [r.code] : [])))];
  if (refs.some((r) => !r.templateId && !r.code)) throw new Error("Say which activity: templateId or code.");
  const found = ids.length || codes.length
    ? await db.select().from(activityTemplates).where(or(
        ids.length ? inArray(activityTemplates.id, ids) : undefined,
        codes.length ? inArray(activityTemplates.code, codes) : undefined,
      ))
    : [];
  return refs.map((r) => {
    const template = found.find((t) => (r.templateId ? t.id === r.templateId : t.code === r.code));
    if (!template) throw new Error(`No activity ${r.code ?? r.templateId}.`);
    return { ref: r, template, period: periodFor(template.frequency, r.date) };
  });
}

const matching = (items: { ref: Ref; template: ActivityTemplate; period: Period }[]) => or(...items.map(({ ref, template, period }) => and(
  eq(activityChecks.brandId, ref.brandId), eq(activityChecks.templateId, template.id), eq(activityChecks.periodKey, period.key),
)));

export type CheckInput = {
  brandId: string;
  templateId?: string;
  code?: string;
  /** Any date inside the period. */
  date: string;
  status: CheckStatus;
  count?: number | null;
  proofUrl?: string | null;
  notes?: string | null;
};

const clean = (s: string | null | undefined) => s?.trim() || null;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

/**
 * Ticks activities for brands, in one statement. Doing one again replaces its
 * record and reopens review — redone work needs checking afresh.
 */
export async function recordChecks(inputs: CheckInput[], actor: Actor, source: "app" | "api" | "auto" = "app") {
  if (inputs.length === 0) return [];
  // Postgres refuses to upsert the same row twice in one statement; the last mention wins.
  const byKey = new Map((await resolve(inputs)).map((i) => [`${i.ref.brandId}:${i.template.id}:${i.period.key}`, i]));
  const items = [...byKey.values()];
  const now = new Date();
  const rows = await db.insert(activityChecks)
    .values(items.map(({ ref, template, period }) => {
      const input = ref as CheckInput;
      return {
        brandId: input.brandId, templateId: template.id,
        periodKey: period.key, periodStart: period.start, periodEnd: period.end,
        status: input.status,
        count: input.count ?? null,
        proofUrl: clean(input.proofUrl),
        notes: clean(input.notes),
        doneByKind: actor.kind,
        doneByName: clean(actor.name),
        doneByUserId: actor.userId,
        doneAt: now,
        source,
        updatedAt: now,
      };
    }))
    .onConflictDoUpdate({
      target: [activityChecks.brandId, activityChecks.templateId, activityChecks.periodKey],
      set: {
        status: excluded("status"), count: excluded("count"), proofUrl: excluded("proof_url"), notes: excluded("notes"),
        doneByKind: excluded("done_by_kind"), doneByName: excluded("done_by_name"), doneByUserId: excluded("done_by_user_id"),
        doneAt: excluded("done_at"), source: excluded("source"), updatedAt: excluded("updated_at"),
        reviewStatus: null, reviewNote: null, reviewerKind: null, reviewerName: null, reviewedByUserId: null, reviewedAt: null,
      },
    })
    .returning();
  return items.map((item) => ({
    ...item,
    check: rows.find((r) => r.brandId === item.ref.brandId && r.templateId === item.template.id && r.periodKey === item.period.key)!,
  }));
}

export async function recordCheck(input: CheckInput, actor: Actor, source: "app" | "api" | "auto" = "app") {
  const [one] = await recordChecks([input], actor, source);
  return one;
}

/** Back to "to do". */
export async function clearChecks(refs: Ref[]) {
  if (refs.length === 0) return 0;
  const rows = await db.delete(activityChecks).where(matching(await resolve(refs))).returning({ id: activityChecks.id });
  return rows.length;
}

/** Signs off (or sends back) recorded work. Refs with nothing recorded are left alone. */
export async function reviewChecks(refs: Ref[], decision: ReviewStatus, note: string | null | undefined, reviewer: Actor) {
  if (refs.length === 0) return [];
  const items = await resolve(refs);
  const now = new Date();
  const rows = await db.update(activityChecks).set({
    reviewStatus: decision,
    reviewNote: clean(note),
    reviewerKind: reviewer.kind,
    reviewerName: clean(reviewer.name),
    reviewedByUserId: reviewer.userId,
    reviewedAt: now,
    updatedAt: now,
  }).where(matching(items)).returning();
  return items.map((item) => ({
    ...item,
    check: rows.find((r) => r.brandId === item.ref.brandId && r.templateId === item.template.id && r.periodKey === item.period.key) ?? null,
  }));
}

/* ---------------------------------------------------------------- report */

/**
 * Completion per brand over the last few periods of each frequency, plus the
 * activities most often missed — the list to fix first.
 */
export async function getActivityReport(brands: PlanBrand[], today: string, periodsBack = 6) {
  const brandIds = brands.map((b) => b.id);
  const [templates, ctx] = await Promise.all([getActivityTemplates(), loadPlanContext(brandIds)]);

  const byFrequency = FREQUENCIES.map((frequency) => ({
    frequency,
    periods: recentPeriods(frequency, today, frequency === "daily" ? 14 : frequency === "every_2_days" ? 10 : periodsBack),
  }));
  const earliest = byFrequency.reduce((m, f) => (f.periods[0].start < m ? f.periods[0].start : m), today);

  const checks = brandIds.length
    ? await db.select({
        brandId: activityChecks.brandId, templateId: activityChecks.templateId, periodKey: activityChecks.periodKey,
        status: activityChecks.status, reviewStatus: activityChecks.reviewStatus, doneByKind: activityChecks.doneByKind,
      }).from(activityChecks)
        .where(and(inArray(activityChecks.brandId, brandIds), gte(activityChecks.periodStart, earliest), lte(activityChecks.periodStart, today)))
    : [];
  const checkBy = new Map(checks.map((c) => [`${c.brandId}:${c.templateId}:${c.periodKey}`, c]));

  const missed = new Map<string, number>();
  const frequencies = byFrequency.map(({ frequency, periods }) => {
    const list = templates.filter((t) => t.frequency === frequency);
    const series = periods.map((period: Period) => {
      const phase = periodPhase(period, today);
      const perBrand = brands.map((b) => {
        const cells = list.flatMap((t) => {
          const plan = planFor(ctx, b.id, t);
          if (!plan.applies || period.end < since(t)) return [];
          const c = checkBy.get(`${b.id}:${t.id}:${period.key}`);
          const status = cellStatus(c ?? null, period, phase, t);
          if (status === "missed") missed.set(t.id, (missed.get(t.id) ?? 0) + 1);
          return [{ applies: true, status }];
        });
        return { brandId: b.id, ...completion(cells) };
      });
      return { period, phase, perBrand, ...sumUp(perBrand) };
    });
    return { frequency, series };
  });

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const mostMissed = [...missed.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([id, count]) => ({ template: templateById.get(id)!, count }));

  const doneByAi = checks.filter((c) => c.doneByKind === "ai").length;
  const awaitingReview = checks.filter((c) => c.reviewStatus === null && c.status !== "skipped").length;

  return { frequencies, mostMissed, totals: { recorded: checks.length, doneByAi, awaitingReview } };
}

function sumUp(perBrand: { total: number; score: number }[]) {
  const total = perBrand.reduce((s, b) => s + b.total, 0);
  const score = perBrand.reduce((s, b) => s + b.score, 0);
  return { total, score, pct: total ? Math.round((score / total) * 100) : 0 };
}

/* ----------------------------------------------------------- agent tokens */

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Returns the secret once. Only its hash is kept. */
export async function createAgentToken(userId: string, name: string) {
  const token = `ggs_${nanoid(40)}`;
  const [row] = await db.insert(agentTokens).values({
    userId, name: name.trim() || "AI agent", tokenHash: hashToken(token), prefix: token.slice(0, 10),
  }).returning({ id: agentTokens.id });
  return { id: row.id, token };
}

/** The agent behind an `Authorization: Bearer ggs_…` or `X-Agent-Token: ggs_…` header, or null. */
export async function authenticateAgent(req: Request) {
  // X-Agent-Token exists because the production site sits behind basic auth,
  // which already occupies the Authorization header.
  const header = req.headers.get("authorization") ?? "";
  const token = (req.headers.get("x-agent-token") ?? (header.startsWith("Bearer ") ? header.slice(7) : "")).trim();
  if (!token.startsWith("ggs_")) return null;
  const row = await db.query.agentTokens.findFirst({
    where: and(eq(agentTokens.tokenHash, hashToken(token)), isNull(agentTokens.revokedAt)),
  });
  if (!row) return null;
  await db.update(agentTokens).set({ lastUsedAt: new Date() }).where(eq(agentTokens.id, row.id));
  return { tokenId: row.id, userId: row.userId, name: row.name };
}
