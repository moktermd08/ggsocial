"use server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, activityTemplates, brandActivitySettings, agentTokens, memberships, type Role } from "@/lib/db";
import { requireUser, can, atLeast, type SessionUser } from "@/lib/auth";
import {
  ACTIVITY_CATEGORIES, CHECK_STATUSES, FREQUENCIES, LEAD_IMPACTS, PERFORMERS, PROOF_KINDS,
  type ActorKind, type ActivityCategory, type CheckStatus, type Frequency, type LeadImpact,
  type Performer, type ProofKind, type ReviewStatus,
} from "@/lib/activities/meta";
import { isDateKey } from "@/lib/activities/periods";
import {
  recordChecks, clearChecks, reviewChecks, roleOn, createAgentToken, ensureActivityLibrary, type Actor,
} from "@/server/activities";

/** One activity for one brand — the unit every bulk action works on. */
export type CheckTarget = { brandId: string; templateId: string };

function done() {
  revalidatePath("/activities");
}

/**
 * Checks every brand once and drops the targets this user may not touch, so a
 * bulk "done for all four brands" never half-fails on a viewer-only brand.
 */
async function allowed(user: SessionUser, targets: CheckTarget[], test: (role: Role) => boolean) {
  const brandIds = [...new Set(targets.map((t) => t.brandId))];
  const rows = brandIds.length
    ? await db.select({ brandId: memberships.brandId, role: memberships.role }).from(memberships)
        .where(and(eq(memberships.userId, user.id), inArray(memberships.brandId, brandIds)))
    : [];
  const ok = new Set(rows.filter((r) => test(r.role)).map((r) => r.brandId));
  const kept = targets.filter((t) => ok.has(t.brandId));
  if (targets.length > 0 && kept.length === 0) throw new Error("You do not have permission to update these brands.");
  return kept;
}

function actorFrom(user: SessionUser, by?: { kind: ActorKind; name?: string | null }): Actor {
  // Work an AI agent did can be logged by a person; the person stays on record as who logged it.
  if (by?.kind === "ai") return { kind: "ai", name: by.name?.trim() || "AI agent", userId: user.id };
  return { kind: "human", name: user.name, userId: user.id };
}

export async function setChecksAction(input: {
  targets: CheckTarget[];
  date: string;
  status: CheckStatus;
  count?: number | null;
  proofUrl?: string | null;
  notes?: string | null;
  by?: { kind: ActorKind; name?: string | null };
}) {
  const user = await requireUser();
  if (!isDateKey(input.date)) throw new Error("Bad date.");
  if (!CHECK_STATUSES.includes(input.status)) throw new Error("Bad status.");
  const targets = await allowed(user, input.targets, can.edit);
  await recordChecks(targets.map((t) => ({
    brandId: t.brandId, templateId: t.templateId, date: input.date, status: input.status,
    count: input.count, proofUrl: input.proofUrl, notes: input.notes,
  })), actorFrom(user, input.by));
  done();
  return { updated: targets.length };
}

export async function clearChecksAction(input: { targets: CheckTarget[]; date: string }) {
  const user = await requireUser();
  if (!isDateKey(input.date)) throw new Error("Bad date.");
  const targets = await allowed(user, input.targets, can.edit);
  const updated = await clearChecks(targets.map((t) => ({ ...t, date: input.date })));
  done();
  return { updated };
}

export async function reviewChecksAction(input: {
  targets: CheckTarget[];
  date: string;
  decision: ReviewStatus;
  note?: string | null;
  by?: { kind: ActorKind; name?: string | null };
}) {
  const user = await requireUser();
  if (!isDateKey(input.date)) throw new Error("Bad date.");
  if (input.decision !== "approved" && input.decision !== "rejected") throw new Error("Bad decision.");
  const targets = await allowed(user, input.targets, (r) => can.approve(r) || can.edit(r));
  // Rows nobody has recorded yet are skipped rather than failing the lot.
  const results = await reviewChecks(targets.map((t) => ({ ...t, date: input.date })), input.decision, input.note, actorFrom(user, input.by));
  const updated = results.filter((r) => r.check).length;
  if (targets.length === 1 && updated === 0) throw new Error("Nothing is recorded there yet, so there is nothing to review.");
  done();
  return { updated };
}

/* ------------------------------------------------------ the master list */

/**
 * The master template is shared by every brand, so changing it is limited to
 * super admins and people who own or run at least one brand.
 */
async function requireLibraryEditor() {
  const user = await requireUser();
  if (user.isSuperAdmin) return user;
  const rows = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, user.id));
  if (!rows.some((r) => atLeast(r.role, "admin"))) throw new Error("Only brand admins can change the master activity list.");
  return user;
}

export type TemplateInput = {
  id?: string;
  code?: string;
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
};

export async function saveTemplateAction(input: TemplateInput) {
  const user = await requireLibraryEditor();
  const title = input.title.trim();
  if (!title) throw new Error("Give the activity a title.");
  if (!ACTIVITY_CATEGORIES.includes(input.category)) throw new Error("Bad category.");
  if (!FREQUENCIES.includes(input.frequency)) throw new Error("Bad frequency.");
  if (!PROOF_KINDS.includes(input.proof) || !PERFORMERS.includes(input.performer) || !LEAD_IMPACTS.includes(input.leadImpact)) {
    throw new Error("Bad option.");
  }
  const values = {
    title,
    description: input.description.trim(),
    category: input.category,
    frequency: input.frequency,
    platforms: [...new Set(input.platforms.map((p) => p.trim()).filter(Boolean))],
    target: Math.max(1, Math.round(input.target) || 1),
    unit: input.unit.trim() || "time",
    proof: input.proof,
    performer: input.performer,
    leadImpact: input.leadImpact,
    estMinutes: Math.max(1, Math.round(input.estMinutes) || 15),
    updatedAt: new Date(),
  };

  if (input.id) {
    await db.update(activityTemplates).set(values).where(eq(activityTemplates.id, input.id));
  } else {
    await ensureActivityLibrary();
    const code = input.code?.trim().toUpperCase() || `C-${Date.now().toString(36).toUpperCase()}`;
    const clash = await db.query.activityTemplates.findFirst({ where: eq(activityTemplates.code, code) });
    if (clash) throw new Error(`Code ${code} is already taken.`);
    await db.insert(activityTemplates).values({ ...values, code, isCustom: true, sortOrder: 100_000, createdBy: user.id });
  }
  done();
}

export async function archiveTemplateAction(templateId: string, archived: boolean) {
  await requireLibraryEditor();
  await db.update(activityTemplates)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(activityTemplates.id, templateId));
  done();
}

/* ------------------------------------------------- one brand's plan */

/** Switch an activity on or off for one brand (null = back to the default), or change its target. */
export async function setBrandActivityAction(input: { brandId: string; templateId: string; enabled: boolean | null; target?: number | null }) {
  const user = await requireUser();
  const role = await roleOn(user.id, input.brandId);
  if (!role || !can.manageBrand(role)) throw new Error("You need admin access to change this brand's plan.");

  const existing = await db.query.brandActivitySettings.findFirst({
    where: and(eq(brandActivitySettings.brandId, input.brandId), eq(brandActivitySettings.templateId, input.templateId)),
  });
  const target = input.target === undefined ? existing?.target ?? null : input.target && input.target > 0 ? Math.round(input.target) : null;

  if (input.enabled === null && target === null) {
    if (existing) await db.delete(brandActivitySettings).where(eq(brandActivitySettings.id, existing.id));
  } else if (existing) {
    // A person's edit takes the row back from any goal that set it.
    await db.update(brandActivitySettings).set({ enabled: input.enabled, target, goalId: null, updatedAt: new Date() })
      .where(eq(brandActivitySettings.id, existing.id));
  } else {
    await db.insert(brandActivitySettings).values({ brandId: input.brandId, templateId: input.templateId, enabled: input.enabled, target });
  }
  done();
}

/* ------------------------------------------------------- agent tokens */

export async function createAgentTokenAction(name: string) {
  const user = await requireUser();
  const created = await createAgentToken(user.id, name);
  done();
  return created;
}

export async function revokeAgentTokenAction(tokenId: string) {
  const user = await requireUser();
  await db.update(agentTokens).set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.id, tokenId), eq(agentTokens.userId, user.id), isNull(agentTokens.revokedAt)));
  done();
}
