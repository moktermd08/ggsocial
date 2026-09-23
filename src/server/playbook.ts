import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import {
  db, attachments, brands, brandPlaybookRules, channels, media, memberships, metrics, playbookAdjustments, playbookRules, posts, postTargets,
  type Role,
} from "@/lib/db";
import { PLAYBOOK_LIBRARY } from "@/lib/playbook/library";
import {
  LIMIT_KEYS, isAdjustField, newItemId, CHECK_AUDIENCES, ENFORCE_LEVELS,
  type AdjustField, type AdjustSource, type AdjustStatus, type ChecklistItem, type LimitKey, type RuleLimits,
} from "@/lib/playbook/meta";
import {
  checkTargets, coerceLimit, decodeValue, effectiveRule, encodeValue, localClock, resolveFormat,
  type BrandOverrideInput, type EffectiveRule, type MasterRuleInput,
} from "@/lib/playbook/check";
import { slotsToWindows, suggestWindows, type Scored } from "@/lib/playbook/tuning";
import type { Actor } from "@/server/activities";
import { atLeast, can } from "@/lib/auth";

export type PlaybookRule = typeof playbookRules.$inferSelect;
export type BrandPlaybookRule = typeof brandPlaybookRules.$inferSelect;
export type PlaybookAdjustment = typeof playbookAdjustments.$inferSelect;

/* ------------------------------------------------------------- the library */

let seeding: Promise<void> | null = null;

/**
 * Inserts any rule in the built-in library that has no row yet. Never
 * overwrites, so edits made in the app stick and new library rules arrive
 * with the next deploy.
 */
export function ensurePlaybookLibrary() {
  seeding ??= db.insert(playbookRules)
    .values(PLAYBOOK_LIBRARY.map((r, i) => ({ ...r, sortOrder: (i + 1) * 10 })))
    .onConflictDoNothing({ target: playbookRules.code })
    .then(() => undefined)
    .catch((e) => {
      seeding = null;
      throw e;
    });
  return seeding;
}

export async function getPlaybookRules(opts: { includeArchived?: boolean } = {}) {
  await ensurePlaybookLibrary();
  return db.select().from(playbookRules)
    .where(opts.includeArchived ? undefined : isNull(playbookRules.archivedAt))
    .orderBy(asc(playbookRules.sortOrder), asc(playbookRules.code));
}

export function masterInput(r: PlaybookRule): MasterRuleInput {
  return {
    id: r.id, code: r.code, kind: r.kind, name: r.name, description: r.description, instructions: r.instructions,
    platforms: r.platforms, activityCodes: r.activityCodes, enforce: r.enforce, limits: r.limits, checklist: r.checklist,
  };
}

function overrideInput(o: BrandPlaybookRule | undefined): BrandOverrideInput | null {
  return o ? {
    enabled: o.enabled, enforce: o.enforce, limits: o.limits, extraChecklist: o.extraChecklist,
    hiddenChecklist: o.hiddenChecklist, notes: o.notes,
  } : null;
}

/** Each brand's playbook as it works to it, keyed by brand id. Disabled rules are included, marked off. */
export async function getBrandPlaybooks(brandIds: string[]) {
  const rules = await getPlaybookRules();
  const overrides = brandIds.length
    ? await db.select().from(brandPlaybookRules).where(inArray(brandPlaybookRules.brandId, brandIds))
    : [];
  const byKey = new Map(overrides.map((o) => [`${o.brandId}:${o.ruleId}`, o]));
  const out = new Map<string, EffectiveRule[]>();
  for (const b of brandIds) {
    out.set(b, rules.map((r) => effectiveRule(masterInput(r), overrideInput(byKey.get(`${b}:${r.id}`)))));
  }
  return out;
}

export async function getBrandPlaybook(brandId: string) {
  return (await getBrandPlaybooks([brandId])).get(brandId) ?? [];
}

/** A rule by id or code — agents address rules by code. */
export async function findRule(ref: string) {
  await ensurePlaybookLibrary();
  const byCode = await db.query.playbookRules.findFirst({ where: eq(playbookRules.code, ref.trim().toLowerCase()) });
  return byCode ?? await db.query.playbookRules.findFirst({ where: eq(playbookRules.id, ref) }) ?? null;
}

/* -------------------------------------------------------- adjusting rules */

function cleanItem(raw: unknown): ChecklistItem {
  const r = (typeof raw === "string" ? { text: raw } : raw ?? {}) as Partial<ChecklistItem>;
  const text = String(r.text ?? "").trim();
  if (!text) throw new Error("A checklist point needs some text.");
  if (text.length > 500) throw new Error("Keep a checklist point under 500 characters.");
  const audience = CHECK_AUDIENCES.includes(r.for as ChecklistItem["for"]) ? r.for! : "all";
  return { id: typeof r.id === "string" && r.id ? r.id : newItemId(), text, for: audience };
}

/**
 * A brand limit going back to the master's value. Distinct from null, which
 * means "no limit here" — a brand can drop a limit the master sets. Callers
 * send the string "inherit"; it is stored as a NULL `after`.
 */
export const INHERIT = "__inherit__";

/** Normalises a new value for a field, or throws with a reason a person or agent can act on. */
export function coerceField(field: AdjustField, raw: unknown): unknown {
  if ((LIMIT_KEYS as string[]).includes(field)) {
    return raw === "inherit" || raw === INHERIT ? INHERIT : coerceLimit(field as LimitKey, raw);
  }
  if (field === "enabled") return raw === null || raw === undefined || raw === "" ? null : raw === true || raw === "true";
  if (field === "enforce") {
    if (raw === null || raw === undefined || raw === "") return null;
    if (!ENFORCE_LEVELS.includes(raw as never)) throw new Error("Strictness must be \"block\" or \"warn\".");
    return raw;
  }
  if (field === "checklist.add") return cleanItem(raw);
  if (field === "checklist") {
    if (!Array.isArray(raw)) throw new Error("The checklist must be a list of points.");
    return raw.map(cleanItem);
  }
  if (field === "instructions") {
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    if (s.length > 8000) throw new Error("Keep instructions under 8,000 characters.");
    return s || null;
  }
  throw new Error(`Unknown field "${field}".`);
}

/** What a brand (or the master) works to for a field right now, as JSON text. */
async function currentValue(rule: PlaybookRule, brandId: string | null, field: AdjustField) {
  if (!brandId) {
    if ((LIMIT_KEYS as string[]).includes(field)) return encodeValue(rule.limits[field as LimitKey]);
    if (field === "enforce") return encodeValue(rule.enforce);
    if (field === "checklist" || field === "checklist.add") return encodeValue(rule.checklist);
    if (field === "instructions") return encodeValue(rule.instructions || null);
    return null;
  }
  const o = await db.query.brandPlaybookRules.findFirst({
    where: and(eq(brandPlaybookRules.brandId, brandId), eq(brandPlaybookRules.ruleId, rule.id)),
  });
  const eff = effectiveRule(masterInput(rule), overrideInput(o));
  if ((LIMIT_KEYS as string[]).includes(field)) return encodeValue(eff.limits[field as LimitKey]);
  if (field === "enabled") return encodeValue(eff.enabled);
  if (field === "enforce") return encodeValue(eff.enforce);
  if (field === "checklist" || field === "checklist.add") return encodeValue(eff.checklist);
  if (field === "instructions") return encodeValue(o?.notes ?? null);
  return null;
}

/** Writes one field. `value` is already coerced; null on a brand means "follow the master again". */
async function writeField(rule: PlaybookRule, brandId: string | null, field: AdjustField, value: unknown) {
  if (!brandId) {
    const set: Partial<PlaybookRule> = { updatedAt: new Date() };
    if ((LIMIT_KEYS as string[]).includes(field)) {
      const limits: RuleLimits = { ...rule.limits };
      if (value === null || value === INHERIT) delete limits[field as LimitKey];
      else (limits as Record<string, unknown>)[field] = value;
      set.limits = limits;
    } else if (field === "enforce") set.enforce = (value as PlaybookRule["enforce"]) ?? "block";
    else if (field === "checklist.add") set.checklist = [...rule.checklist, value as ChecklistItem];
    else if (field === "checklist") set.checklist = value as ChecklistItem[];
    else if (field === "instructions") set.instructions = (value as string | null) ?? "";
    else throw new Error("The master rule cannot be switched off per field — archive it instead.");
    await db.update(playbookRules).set(set).where(eq(playbookRules.id, rule.id));
    return;
  }

  const existing = await db.query.brandPlaybookRules.findFirst({
    where: and(eq(brandPlaybookRules.brandId, brandId), eq(brandPlaybookRules.ruleId, rule.id)),
  });
  const row = {
    enabled: existing?.enabled ?? null,
    enforce: existing?.enforce ?? null,
    limits: { ...(existing?.limits ?? {}) } as RuleLimits,
    extraChecklist: existing?.extraChecklist ?? [],
    hiddenChecklist: existing?.hiddenChecklist ?? [],
    notes: existing?.notes ?? null,
  };
  if ((LIMIT_KEYS as string[]).includes(field)) {
    const key = field as LimitKey;
    // Setting the master's own value is the same as following it; null is kept, as "no limit here".
    if (value === INHERIT || value === rule.limits[key]) delete row.limits[key];
    else (row.limits as Record<string, unknown>)[key] = value;
  } else if (field === "enabled") row.enabled = value === true ? null : (value as boolean | null);
  else if (field === "enforce") row.enforce = value === rule.enforce ? null : (value as typeof row.enforce);
  else if (field === "checklist.add") row.extraChecklist = [...row.extraChecklist, value as ChecklistItem];
  else if (field === "checklist") {
    // Master points kept unchanged stay linked to the master; anything new or reworded is this brand's own.
    const items = value as ChecklistItem[];
    const master = new Map(rule.checklist.map((i) => [i.id, i]));
    const kept = new Set(items.filter((i) => {
      const m = master.get(i.id);
      return m && m.text === i.text && m.for === i.for;
    }).map((i) => i.id));
    row.hiddenChecklist = rule.checklist.filter((i) => !kept.has(i.id)).map((i) => i.id);
    row.extraChecklist = items.filter((i) => !kept.has(i.id)).map((i) => (master.has(i.id) ? { ...i, id: newItemId() } : i));
  } else if (field === "instructions") row.notes = value as string | null;

  const empty = row.enabled === null && row.enforce === null && Object.keys(row.limits).length === 0
    && row.extraChecklist.length === 0 && row.hiddenChecklist.length === 0 && !row.notes;
  if (existing && empty) await db.delete(brandPlaybookRules).where(eq(brandPlaybookRules.id, existing.id));
  else if (existing) await db.update(brandPlaybookRules).set({ ...row, updatedAt: new Date() }).where(eq(brandPlaybookRules.id, existing.id));
  else if (!empty) await db.insert(brandPlaybookRules).values({ brandId, ruleId: rule.id, ...row });
}

export type AdjustInput = {
  rule: PlaybookRule;
  /** null = the master rule. */
  brandId: string | null;
  field: string;
  value: unknown;
  reason?: string | null;
  evidence?: Record<string, unknown> | null;
  source: AdjustSource;
  actor: Actor;
  /** false = leave it for someone to approve in the daily review. */
  apply: boolean;
};

/**
 * Changes a rule now, or proposes the change for the daily review. Either
 * way it is logged with the value before and after and the reason, and an
 * older open suggestion for the same field is closed as superseded.
 */
export async function adjustRule(input: AdjustInput) {
  if (!isAdjustField(input.field)) throw new Error(`Unknown field "${input.field}". Use a limit (e.g. hashtagsMax, windows), enabled, enforce, checklist.add, checklist or instructions.`);
  const field = input.field;
  if (!input.brandId && field === "enabled") throw new Error("Switch a rule off per brand, or archive the master rule.");
  const value = coerceField(field, input.value);
  const before = await currentValue(input.rule, input.brandId, field);
  const after = value === INHERIT ? null : encodeValue(value);
  if (field !== "checklist.add" && before === after) throw new Error("That is already the value.");

  const scope = and(
    eq(playbookAdjustments.ruleId, input.rule.id),
    input.brandId ? eq(playbookAdjustments.brandId, input.brandId) : isNull(playbookAdjustments.brandId),
    eq(playbookAdjustments.field, field),
    eq(playbookAdjustments.status, "proposed"),
  );
  await db.update(playbookAdjustments).set({ status: "superseded" }).where(scope);

  if (input.apply) await writeField(input.rule, input.brandId, field, value);
  const [row] = await db.insert(playbookAdjustments).values({
    ruleId: input.rule.id, brandId: input.brandId, field, before, after,
    reason: input.reason?.trim() ?? "", evidence: input.evidence ?? null,
    status: input.apply ? "applied" : "proposed", source: input.source,
    actorKind: input.actor.kind, actorName: input.actor.name, userId: input.actor.userId,
    ...(input.apply ? { decidedKind: input.actor.kind, decidedName: input.actor.name, decidedBy: input.actor.userId, decidedAt: new Date() } : {}),
  }).returning();
  return row;
}

/** Approves (applies) or rejects a proposed adjustment. */
export async function decideAdjustment(id: string, decision: "applied" | "rejected", note: string | null | undefined, actor: Actor) {
  const adj = await db.query.playbookAdjustments.findFirst({ where: eq(playbookAdjustments.id, id) });
  if (!adj) throw new Error("That suggestion no longer exists.");
  if (adj.status !== "proposed") throw new Error("That suggestion has already been decided.");
  const rule = await db.query.playbookRules.findFirst({ where: eq(playbookRules.id, adj.ruleId) });
  if (!rule) throw new Error("The rule behind that suggestion is gone.");
  const value = adj.after === null && (LIMIT_KEYS as string[]).includes(adj.field) ? INHERIT : decodeValue(adj.after);
  if (decision === "applied") await writeField(rule, adj.brandId, adj.field as AdjustField, value);
  const [row] = await db.update(playbookAdjustments).set({
    status: decision, decisionNote: note?.trim() || null,
    decidedKind: actor.kind, decidedName: actor.name, decidedBy: actor.userId, decidedAt: new Date(),
  }).where(eq(playbookAdjustments.id, id)).returning();
  return row;
}

export async function listAdjustments(opts: { brandIds: string[]; includeMaster?: boolean; status?: AdjustStatus; limit?: number }) {
  const scopes = [];
  if (opts.brandIds.length) scopes.push(inArray(playbookAdjustments.brandId, opts.brandIds));
  if (opts.includeMaster) scopes.push(isNull(playbookAdjustments.brandId));
  if (scopes.length === 0) return [];
  const where = [scopes.length === 1 ? scopes[0] : or(...scopes)];
  if (opts.status) where.push(eq(playbookAdjustments.status, opts.status));
  return db.select({ adjustment: playbookAdjustments, rule: { code: playbookRules.code, name: playbookRules.name } })
    .from(playbookAdjustments)
    .innerJoin(playbookRules, eq(playbookRules.id, playbookAdjustments.ruleId))
    .where(and(...where))
    .orderBy(desc(playbookAdjustments.createdAt))
    .limit(opts.limit ?? 200);
}

/* --------------------------------------------------------- checking posts */

/** A saved post against its brand's playbook — what the review panel and approval work from. */
export async function checkSavedPost(postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return null;
  const [brand, targetRows, mediaRows, rules] = await Promise.all([
    db.query.brands.findFirst({ where: eq(brands.id, post.brandId) }),
    db.select({ target: postTargets, platform: channels.platform, handle: channels.handle }).from(postTargets)
      .innerJoin(channels, eq(channels.id, postTargets.channelId)).where(eq(postTargets.postId, postId)),
    db.select({ item: media, position: attachments.position }).from(attachments)
      .innerJoin(media, eq(media.id, attachments.mediaId))
      .where(and(eq(attachments.postId, postId), isNull(attachments.targetId)))
      .orderBy(asc(attachments.position)),
    getBrandPlaybook(post.brandId),
  ]);
  const results = checkTargets(rules, {
    title: post.title, body: post.body, postType: post.postType,
    scheduledAt: post.scheduledAt?.toISOString() ?? null, timezone: brand?.timezone ?? "UTC",
    media: mediaRows.map((m) => m.item),
    targets: targetRows.filter((t) => t.target.status !== "skipped").map((t) => ({
      channelId: t.target.channelId, platform: t.platform, bodyOverride: t.target.bodyOverride,
      firstComment: t.target.firstComment, options: t.target.options,
    })),
  });
  return results.map((r) => ({ ...r, handle: targetRows.find((t) => t.target.channelId === r.channelId)?.handle ?? "" }));
}

/** The blocking problems in a set of checks, as one sentence for an error message. */
export function blockingText(results: { issues: { level: string; message: string }[] }[]) {
  const errors = [...new Set(results.flatMap((r) => r.issues.filter((i) => i.level === "error").map((i) => i.message)))];
  return errors.length ? `Playbook: ${errors.join(" ")}` : null;
}

/* ------------------------------------------------------------ daily tuning */

const LOOKBACK_DAYS = 120;
/** A rejected suggestion is not made again for this long. */
const QUIET_DAYS = 30;

/**
 * Looks at what each brand actually published in each format and when, and
 * proposes posting windows where the numbers clearly favour different hours.
 * It only ever proposes: a person or an agent approves in the daily review.
 * Idempotent, so running it every hour does no harm.
 */
export async function runPlaybookTuning(now = new Date()) {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const rows = await db.select({
    targetId: postTargets.id, publishedAt: postTargets.publishedAt, options: postTargets.options,
    platform: channels.platform, brandId: channels.brandId, postId: posts.id, postType: posts.postType,
  }).from(postTargets)
    .innerJoin(channels, eq(channels.id, postTargets.channelId))
    .innerJoin(posts, eq(posts.id, postTargets.postId))
    .where(and(eq(postTargets.status, "published"), gte(postTargets.publishedAt, since)));
  if (rows.length === 0) return { scanned: 0, proposed: [] };

  const targetIds = rows.map((r) => r.targetId);
  const postIds = [...new Set(rows.map((r) => r.postId))];
  const brandIds = [...new Set(rows.map((r) => r.brandId))];
  const [latest, kinds, brandRows, playbooks] = await Promise.all([
    db.selectDistinctOn([metrics.targetId]).from(metrics)
      .where(inArray(metrics.targetId, targetIds))
      .orderBy(metrics.targetId, desc(metrics.fetchedAt)),
    db.select({ postId: attachments.postId, kind: media.kind }).from(attachments)
      .innerJoin(media, eq(media.id, attachments.mediaId))
      .where(and(inArray(attachments.postId, postIds), isNull(attachments.targetId))),
    db.select({ id: brands.id, timezone: brands.timezone }).from(brands).where(inArray(brands.id, brandIds)),
    getBrandPlaybooks(brandIds),
  ]);
  const metricBy = new Map(latest.map((m) => [m.targetId, m]));
  const mediaBy = new Map<string, { kind: string }[]>();
  for (const k of kinds) (mediaBy.get(k.postId) ?? mediaBy.set(k.postId, []).get(k.postId)!).push({ kind: k.kind });
  const tzBy = new Map(brandRows.map((b) => [b.id, b.timezone]));

  // brand → rule code → scored posts
  const groups = new Map<string, Map<string, Scored[]>>();
  let scanned = 0;
  for (const r of rows) {
    const m = metricBy.get(r.targetId);
    const seen = m ? m.reach || m.impressions : 0;
    if (!m || !seen || !r.publishedAt) continue;
    const rule = resolveFormat(playbooks.get(r.brandId) ?? [], {
      platform: r.platform, options: r.options, postType: r.postType, media: mediaBy.get(r.postId) ?? [],
    });
    if (!rule?.limits.windows) continue;
    const rate = ((m.likes + m.commentCount + m.shares + m.saves + m.clicks) / seen) * 100;
    const byRule = groups.get(r.brandId) ?? groups.set(r.brandId, new Map()).get(r.brandId)!;
    (byRule.get(rule.code) ?? byRule.set(rule.code, []).get(rule.code)!).push({
      minute: localClock(r.publishedAt.toISOString(), tzBy.get(r.brandId) ?? "UTC").minute, rate,
    });
    scanned++;
  }

  const proposed: { brandId: string; rule: string; windows: string; reason: string }[] = [];
  const quietSince = new Date(now.getTime() - QUIET_DAYS * 86_400_000);
  for (const [brandId, byRule] of groups) {
    for (const [code, scored] of byRule) {
      const rule = playbooks.get(brandId)!.find((r) => r.code === code)!;
      const found = suggestWindows(scored, rule.limits.windows);
      if (!found) continue;
      const { windows, bestAvg, base, baseIsCurrent, best } = found;

      const after = encodeValue(windows);
      const recent = await db.query.playbookAdjustments.findFirst({
        where: and(
          eq(playbookAdjustments.ruleId, rule.id), eq(playbookAdjustments.brandId, brandId),
          eq(playbookAdjustments.field, "windows"), eq(playbookAdjustments.after, after!),
          inArray(playbookAdjustments.status, ["proposed", "rejected"]), gte(playbookAdjustments.createdAt, quietSince),
        ),
      });
      if (recent) continue;

      const reason = `${rule.name} posts published ${windows.replace(/, /g, " and ")} averaged ${bestAvg.toFixed(1)}% engagement `
        + `over ${best.reduce((n, b) => n + b.posts, 0)} posts, against ${base.toFixed(1)}% ${baseIsCurrent ? "inside the current windows" : "overall"} `
        + `(${scored.length} posts in the last ${LOOKBACK_DAYS} days).`;
      const master = await db.query.playbookRules.findFirst({ where: eq(playbookRules.id, rule.id) });
      await adjustRule({
        rule: master!, brandId, field: "windows", value: windows, reason,
        evidence: { sample: scored.length, base: Number(base.toFixed(2)), best: best.map((b) => ({ slot: slotsToWindows([b.start]), posts: b.posts, rate: Number(b.avg.toFixed(2)) })) },
        source: "auto", actor: { kind: "ai", name: "Daily tuning", userId: null }, apply: false,
      });
      proposed.push({ brandId, rule: code, windows, reason });
    }
  }
  return { scanned, proposed };
}


/* ------------------------------------------------------------- permissions */

/**
 * Who may change the master playbook: super admins and anyone who runs at
 * least one brand — the same people who edit the master activity list.
 */
export async function canEditMaster(user: { id: string; isSuperAdmin: boolean }) {
  if (user.isSuperAdmin) return true;
  const rows = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, user.id));
  return rows.some((r) => atLeast(r.role, "admin"));
}

/**
 * On a brand, approvers and admins change the playbook straight away;
 * editors (people or their agents) can only suggest, for the daily review.
 */
export function brandAdjustRights(role: Role | null) {
  if (!role) return { propose: false, apply: false };
  return { propose: can.edit(role) || can.approve(role), apply: can.approve(role) || can.manageBrand(role) };
}
