import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());
vi.mock("@/server/alerts", () => ({ sendAlert: vi.fn(async () => {}) }));
vi.mock("@/server/media", () => ({ publicUrl: (u: string) => u }));

import { db, users, brands, workflowRuns, workflowRunSteps } from "@/lib/db";
import { approveCleanStep } from "@/server/workflows";

const verdict = (score: number, flags: string[] = []) => ({ score, flags, summary: "ok", fixes: [], model: "m", reviewedAt: new Date().toISOString() });

async function pausedStep(review: unknown, kind: "review" | "safety" = "review") {
  const [u] = await db.insert(users).values({ email: `u${Math.random()}@t.test`, name: "U", passwordHash: "x" }).returning();
  const [brand] = await db.insert(brands).values({ name: "B", slug: `b-${Math.random()}`, reviewThreshold: 75 }).returning();
  const [run] = await db.insert(workflowRuns).values({ brandId: brand.id, workflowCode: "publish-post", status: "waiting_review", stepIndex: 0 }).returning();
  const [step] = await db.insert(workflowRunSteps).values({
    runId: run.id, brandId: brand.id, stepKey: "draft", status: "paused", output: { review },
    pause: { kind, question: "Approve?", reasons: [], after: true, sendBackTo: "draft" },
  }).returning();
  return { user: u, step };
}
const decision = async (id: string) => (await db.query.workflowRunSteps.findFirst({ where: eq(workflowRunSteps.id, id) }))?.decision ?? null;

describe("approveCleanStep (dashboard approve)", () => {
  it("approves work the reviewer passed cleanly", async () => {
    const { user, step } = await pausedStep(verdict(90));
    await approveCleanStep(step.id, user.id);
    expect(await decision(step.id)).toBe("approved");
  });
  it("refuses a flagged verdict even if the page offered the button", async () => {
    const { user, step } = await pausedStep(verdict(95, ["legal"]));
    await expect(approveCleanStep(step.id, user.id)).rejects.toThrow(/flagged/);
    expect(await decision(step.id)).toBeNull();
  });
  it("refuses a score under the brand's pass mark, and a missing verdict", async () => {
    const low = await pausedStep(verdict(60));
    await expect(approveCleanStep(low.step.id, low.user.id)).rejects.toThrow();
    const none = await pausedStep({ skipped: "no key" });
    await expect(approveCleanStep(none.step.id, none.user.id)).rejects.toThrow();
  });
  it("refuses a safety stop", async () => {
    const { user, step } = await pausedStep(verdict(95), "safety");
    await expect(approveCleanStep(step.id, user.id)).rejects.toThrow();
  });
  it("cannot approve the same step twice", async () => {
    const { user, step } = await pausedStep(verdict(90));
    await approveCleanStep(step.id, user.id);
    await expect(approveCleanStep(step.id, user.id)).rejects.toThrow(/no longer/);
  });
});
