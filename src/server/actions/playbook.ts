"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, playbookAdjustments, playbookRules } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import {
  ENFORCE_LEVELS, LIMIT_KEYS, RULE_KINDS,
  type ChecklistItem, type EnforceLevel, type LimitKey, type RuleKind,
} from "@/lib/playbook/meta";
import { roleOn } from "@/server/activities";
import {
  adjustRule, brandAdjustRights, canEditMaster, decideAdjustment, ensurePlaybookLibrary, type PlaybookRule,
} from "@/server/playbook";

function done() {
  revalidatePath("/playbook");
  revalidatePath("/activities");
}

const human = (user: SessionUser) => ({ kind: "human" as const, name: user.name, userId: user.id });

async function requireMasterEditor() {
  const user = await requireUser();
  if (!(await canEditMaster(user))) throw new Error("Only brand admins can change the master playbook.");
  return user;
}

export type RuleInput = {
  id?: string;
  code?: string;
  kind: RuleKind;
  name: string;
  description: string;
  instructions: string;
  platforms: string[];
  activityCodes: string[];
  enforce: EnforceLevel;
  limits: Partial<Record<LimitKey, unknown>>;
  checklist: ChecklistItem[];
  /** Why, for the change log. */
  reason?: string;
};

/**
 * Saves a master rule. Identity fields (name, platforms…) are written
 * directly; every limit, the checklist, the instructions and the strictness go
 * through the change log one field at a time, so the history shows exactly
 * what moved.
 */
export async function saveRuleAction(input: RuleInput) {
  return asResult(async () => {
    const user = await requireMasterEditor();
    const name = input.name.trim();
    if (!name) throw new Error("Give the rule a name.");
    if (!RULE_KINDS.includes(input.kind)) throw new Error("Bad kind.");
    if (!ENFORCE_LEVELS.includes(input.enforce)) throw new Error("Bad strictness.");
    const identity = {
      name, kind: input.kind,
      description: input.description.trim(),
      platforms: [...new Set(input.platforms.map((p) => p.trim()).filter(Boolean))],
      activityCodes: [...new Set(input.activityCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))],
      updatedAt: new Date(),
    };

    let rule: PlaybookRule;
    if (input.id) {
      const found = await db.query.playbookRules.findFirst({ where: eq(playbookRules.id, input.id) });
      if (!found) throw new Error("That rule no longer exists.");
      [rule] = await db.update(playbookRules).set(identity).where(eq(playbookRules.id, input.id)).returning();
    } else {
      await ensurePlaybookLibrary();
      const code = (input.code?.trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!code) throw new Error("Give the rule a code.");
      const clash = await db.query.playbookRules.findFirst({ where: eq(playbookRules.code, code) });
      if (clash) throw new Error(`The code "${code}" is already taken.`);
      [rule] = await db.insert(playbookRules).values({
        ...identity, code, enforce: input.enforce, isCustom: true, sortOrder: 100_000, createdBy: user.id,
      }).returning();
    }

    const reason = input.reason?.trim() || (input.id ? "Edited the master rule." : "Created the rule.");
    const changes: [string, unknown][] = [];
    for (const k of LIMIT_KEYS) {
      const next = input.limits[k];
      const blank = next === undefined || next === null || next === "";
      if (blank && rule.limits[k] === undefined) continue;
      changes.push([k, blank ? null : next]);
    }
    changes.push(["enforce", input.enforce], ["instructions", input.instructions], ["checklist", input.checklist]);

    for (const [field, value] of changes) {
      // Re-read each time: every write moves the row on.
      const fresh = (await db.query.playbookRules.findFirst({ where: eq(playbookRules.id, rule.id) }))!;
      try {
        await adjustRule({ rule: fresh, brandId: null, field, value, reason, source: "manual", actor: human(user), apply: true });
      } catch (e) {
        if (e instanceof Error && e.message === "That is already the value.") continue;
        throw e;
      }
    }
    done();
    return { id: rule.id };
  });
}

export async function archiveRuleAction(ruleId: string, archived: boolean) {
  return asResult(async () => {
    await requireMasterEditor();
    await db.update(playbookRules).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(playbookRules.id, ruleId));
    done();
  });
}

/**
 * One brand's change to one field of a rule. Approvers and admins apply it;
 * editors' changes wait in the daily review.
 */
export async function adjustBrandRuleAction(input: { brandId: string; ruleId: string; field: string; value: unknown; reason?: string }) {
  return asResult(async () => {
    const user = await requireUser();
    const rights = brandAdjustRights(await roleOn(user.id, input.brandId));
    if (!rights.propose) throw new Error("You need editor access on this brand to change its playbook.");
    const rule = await db.query.playbookRules.findFirst({ where: eq(playbookRules.id, input.ruleId) });
    if (!rule) throw new Error("That rule no longer exists.");
    const row = await adjustRule({
      rule, brandId: input.brandId, field: input.field, value: input.value, reason: input.reason,
      source: "manual", actor: human(user), apply: rights.apply,
    });
    done();
    return { status: row.status };
  });
}

/** Approve or reject a suggestion in the daily review. */
export async function decideAdjustmentAction(input: { id: string; decision: "applied" | "rejected"; note?: string }) {
  return asResult(async () => {
    const user = await requireUser();
    if (input.decision !== "applied" && input.decision !== "rejected") throw new Error("Bad decision.");
    const adj = await db.query.playbookAdjustments.findFirst({ where: eq(playbookAdjustments.id, input.id) });
    if (!adj) throw new Error("That suggestion no longer exists.");
    const allowed = adj.brandId
      ? brandAdjustRights(await roleOn(user.id, adj.brandId)).apply
      : await canEditMaster(user);
    if (!allowed) throw new Error(adj.brandId ? "Approvers and admins decide suggestions for this brand." : "Only brand admins decide master changes.");
    await decideAdjustment(input.id, input.decision, input.note, human(user));
    done();
  });
}
