"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, activity, brands, workflowRunSteps } from "@/lib/db";
import { requireBrandRole, can } from "@/lib/auth";
import { isWorkflowCode, stepDef } from "@/lib/workflows/meta";
import { decide, setStepReview, type Decision } from "@/server/workflows";

const DECISIONS: Decision[] = ["approve", "send_back", "reject", "done"];

/**
 * A person's answer to a paused step in the review inbox. Reviews and safety
 * stops need approver access, as approving a post does; a task for a person
 * ("attach media") needs editor access, as doing it would.
 */
export async function decideStepAction(input: { stepId: string; decision: string; note?: string | null }) {
  return asResult(async () => {
    if (!DECISIONS.includes(input.decision as Decision)) throw new Error("Unknown decision.");
    const row = await db.query.workflowRunSteps.findFirst({ where: eq(workflowRunSteps.id, input.stepId) });
    if (!row?.pause) throw new Error("This is no longer waiting for a decision.");
    const { user, role } = await requireBrandRole(row.brandId, "viewer");
    if (row.pause.kind === "human" ? !can.edit(role) : !can.approve(role)) {
      throw new Error(row.pause.kind === "human" ? "You need editor access to do this." : "You need approver or admin access to decide this.");
    }
    const message = await decide({ stepId: row.id, decision: input.decision as Decision, note: input.note ?? null, userId: user.id });
    revalidatePath("/", "layout");
    return { message };
  });
}

/**
 * Whether a person reviews a step, for one brand. Only the brand's owner may
 * switch review off — that is what lets agents act in the brand's name
 * unwatched. Switching it back on is the safe direction, so admins and
 * approvers may do that too.
 */
export async function setStepReviewAction(input: { brandId: string; code: string; stepKey: string; review: boolean; reason?: string | null }) {
  return asResult(async () => {
    if (!isWorkflowCode(input.code) || !stepDef(input.code, input.stepKey)) throw new Error("Unknown step.");
    const { user, role } = await requireBrandRole(input.brandId, "viewer");
    if (!input.review && role !== "owner") throw new Error("Only the brand's owner can switch review off.");
    if (input.review && !(role === "owner" || can.approve(role))) throw new Error("You need approver, admin or owner access to change this.");
    const reason = input.reason?.trim() || null;
    if (!input.review && !reason) throw new Error("Say why review can come off this step — it is kept in the log.");
    await setStepReview({ brandId: input.brandId, code: input.code, stepKey: input.stepKey, review: input.review, reason, userId: user.id });
    revalidatePath("/workflows");
  });
}

/**
 * A brand's daily AI budget and the reviewer score its agents' work must
 * reach. Owner only: both decide how much runs, and what goes out, unwatched.
 */
export async function setAutomationAction(input: { brandId: string; aiDailyBudget: number; reviewThreshold: number }) {
  return asResult(async () => {
    const { user, role } = await requireBrandRole(input.brandId, "viewer");
    if (role !== "owner") throw new Error("Only the brand's owner can change the AI budget and the review score.");
    const budget = Number(input.aiDailyBudget);
    const threshold = Math.round(Number(input.reviewThreshold));
    if (!Number.isFinite(budget) || budget < 0 || budget > 1000) throw new Error("The daily budget must be between $0 and $1,000.");
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error("The review score must be between 0 and 100.");
    const before = await db.query.brands.findFirst({ where: eq(brands.id, input.brandId), columns: { aiDailyBudget: true, reviewThreshold: true } });
    await db.update(brands).set({ aiDailyBudget: Math.round(budget * 100) / 100, reviewThreshold: threshold }).where(eq(brands.id, input.brandId));
    await db.insert(activity).values({
      brandId: input.brandId, actorId: user.id, action: "workflow.automation_changed", entity: "brand", entityId: input.brandId,
      meta: { before, after: { aiDailyBudget: budget, reviewThreshold: threshold } },
    });
    revalidatePath("/workflows");
  });
}
