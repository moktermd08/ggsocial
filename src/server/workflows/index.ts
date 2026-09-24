import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db, activity, brands, workflowRuns, workflowRunSteps, workflowStepSettings } from "@/lib/db";
import {
  MAX_ATTEMPTS, MAX_REVISIONS, WORKFLOW_BY_CODE, stepDef,
  type Pause, type RunStatus, type StepDecision, type WorkflowCode,
} from "@/lib/workflows/meta";
import { screenCopy } from "@/lib/workflows/safety";
import { isVerdict, type ReviewRecord } from "@/lib/workflows/review";
import { draftingConfigured } from "@/server/drafting";
import { BudgetError, assertBudget } from "@/server/ai-usage";
import { reviewWork, verdictReasons } from "@/server/reviewer";
import { publishPost } from "@/server/workflows/publish-post";
import { answerEngagement } from "@/server/workflows/answer-engagement";
import { planIdeas } from "@/server/workflows/plan-ideas";
import type { Brand, StepResult, WorkflowImpl, WorkflowRun } from "@/server/workflows/types";

export type RunStep = typeof workflowRunSteps.$inferSelect;

/**
 * Each workflow's step handlers. Read when a run needs them, never while
 * modules load: the handlers reach publishing and Engagement, which reach
 * back here, and a lookup table built at load time would read them before
 * they exist.
 */
function implFor(code: WorkflowCode): WorkflowImpl {
  const impls: Record<WorkflowCode, WorkflowImpl> = {
    "publish-post": publishPost,
    "answer-engagement": answerEngagement,
    "plan-ideas": planIdeas,
  };
  return impls[code];
}

/** How long one worker holds a run. A run still held after this died with its process. */
const LEASE_MS = 15 * 60_000;
const OPEN: RunStatus[] = ["running", "waiting", "waiting_review", "waiting_human"];

/* -------------------------------------------------------------- settings */

/** Every step setting a brand has changed. No row = review is on. */
export async function getStepSettings(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  return db.select().from(workflowStepSettings).where(inArray(workflowStepSettings.brandId, brandIds));
}

async function reviewOn(brandId: string, code: WorkflowCode, stepKey: string) {
  if (!stepDef(code, stepKey)?.reviewable) return false;
  const row = await db.query.workflowStepSettings.findFirst({
    where: and(eq(workflowStepSettings.brandId, brandId), eq(workflowStepSettings.workflowCode, code), eq(workflowStepSettings.stepKey, stepKey)),
    columns: { review: true },
  });
  return row?.review ?? true;
}

export async function setStepReview(input: {
  brandId: string; code: WorkflowCode; stepKey: string; review: boolean; reason: string | null; userId: string;
}) {
  const step = stepDef(input.code, input.stepKey);
  if (!step?.reviewable) throw new Error("That step has nothing for a person to review.");
  await db.insert(workflowStepSettings).values({
    brandId: input.brandId, workflowCode: input.code, stepKey: input.stepKey,
    review: input.review, reason: input.reason, updatedBy: input.userId,
  }).onConflictDoUpdate({
    target: [workflowStepSettings.brandId, workflowStepSettings.workflowCode, workflowStepSettings.stepKey],
    set: { review: input.review, reason: input.reason, updatedBy: input.userId, updatedAt: new Date() },
  });
  await db.insert(activity).values({
    brandId: input.brandId, actorId: input.userId,
    action: input.review ? "workflow.review_on" : "workflow.review_off",
    entity: "workflow", entityId: input.code,
    meta: { step: input.stepKey, reason: input.reason },
  });
}

/* ------------------------------------------------------------------ runs */

export async function startRun(input: {
  brandId: string; code: WorkflowCode; context?: Record<string, unknown>; startedBy: string;
  subject?: { type: string; id: string };
}) {
  const [run] = await db.insert(workflowRuns).values({
    brandId: input.brandId, workflowCode: input.code, context: input.context ?? {},
    startedBy: input.startedBy, nextAt: new Date(),
    subjectType: input.subject?.type ?? null, subjectId: input.subject?.id ?? null,
  }).returning();
  return run;
}

export async function runForSubject(type: string, id: string) {
  return db.query.workflowRuns.findFirst({
    where: and(eq(workflowRuns.subjectType, type), eq(workflowRuns.subjectId, id), inArray(workflowRuns.status, OPEN)),
    orderBy: desc(workflowRuns.startedAt),
  });
}

/** Runs already working on these subjects, open or not. */
export async function runsForSubjects(type: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(workflowRuns).where(and(eq(workflowRuns.subjectType, type), inArray(workflowRuns.subjectId, ids)));
}

async function claim(runId: string, now: Date) {
  const rows = await db.update(workflowRuns).set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(workflowRuns.id, runId), or(isNull(workflowRuns.leaseUntil), lt(workflowRuns.leaseUntil, now))))
    .returning();
  return rows[0] ?? null;
}

async function openPause(runId: string, stepKey: string) {
  return db.query.workflowRunSteps.findFirst({
    where: and(eq(workflowRunSteps.runId, runId), eq(workflowRunSteps.stepKey, stepKey),
      eq(workflowRunSteps.status, "paused"), isNull(workflowRunSteps.decision)),
    orderBy: desc(workflowRunSteps.createdAt),
  });
}

export type AdvanceReport = {
  run: WorkflowRun;
  /** Every step that did something in this call, in order. */
  steps: { key: string; outcome: StepResult["outcome"] | "failed"; summary: string; usage: StepResultUsage }[];
};
type StepResultUsage = Extract<StepResult, { outcome: "done" }>["usage"];

/**
 * Moves a run forward, step by step, until it finishes, has to wait, or stops
 * for a person. Agent steps only run when `agentSteps` is set: a web request
 * should not sit through a model call, so it leaves those to the tick.
 */
export async function advance(runId: string, opts: { agentSteps: boolean; now?: Date }): Promise<AdvanceReport | null> {
  const now = opts.now ?? new Date();
  let run = await claim(runId, now);
  if (!run) return null;
  const report: AdvanceReport = { run, steps: [] };
  try {
    const brand = await db.query.brands.findFirst({ where: eq(brands.id, run.brandId) });
    const def = WORKFLOW_BY_CODE[run.workflowCode];
    const impl = implFor(run.workflowCode);
    if (!brand || !def || !impl || brand.archivedAt) {
      run = await update(run, { status: "cancelled", summary: "The brand or workflow no longer exists.", finishedAt: now });
      return report;
    }

    // A run comes in due (running, or waiting to be looked at again) and keeps
    // going only while each step lets it: any pause, wait or end stops here.
    if (!["running", "waiting", "waiting_human"].includes(run.status)) return report;
    for (let guard = 0; guard < def.steps.length + 2; guard++) {
      if (guard > 0 && run.status !== "running") break;
      if (run.stepIndex >= def.steps.length) {
        run = await update(run, { status: "done", nextAt: null, finishedAt: new Date() });
        break;
      }
      const step = def.steps[run.stepIndex];
      if (step.performer === "agent" && !step.fast && !opts.agentSteps) {
        run = await update(run, { status: "running", nextAt: now });
        break;
      }
      if (step.performer === "agent" && !step.fast) {
        // The daily budget is a safety stop: an agent never calls Claude past it.
        try {
          await assertBudget(brand, now);
        } catch (err) {
          if (!(err instanceof BudgetError)) throw err;
          await pauseStep(run, step.key, {
            kind: "safety", question: "Raise the brand's AI budget in Workflows, or wait for tomorrow, then retry.",
            reasons: [err.message], href: "/workflows", after: false, sendBackTo: null,
          }, { summary: err.message });
          run = await update(run, { status: "waiting_review", nextAt: null, summary: "Stopped: today's AI budget is spent." });
          report.steps.push({ key: step.key, outcome: "stop", summary: err.message, usage: null });
          break;
        }
      }

      const retry = run.context.retryStep === step.key;
      let result: StepResult;
      try {
        result = await impl.handlers[step.key]({ run, brand, step, feedback: run.feedback, retry, now });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[workflows] ${run.workflowCode}/${step.key} on ${brand.name} failed`, err);
        const attempts = run.attempts + 1;
        report.steps.push({ key: step.key, outcome: "failed", summary: message, usage: null });
        if (attempts >= MAX_ATTEMPTS) {
          // A step that keeps failing is a safety stop, not a silent retry loop.
          await pauseStep(run, step.key, {
            kind: "safety", question: "This step keeps failing. Fix the cause, then retry it — or stop the run.",
            reasons: [`Failed ${attempts} times in a row. Last error: ${message}`],
            after: false, sendBackTo: null,
          }, { summary: message, error: message });
          run = await update(run, { status: "waiting_review", attempts, nextAt: null, summary: `Stopped: ${step.name} keeps failing.` });
        } else {
          await db.insert(workflowRunSteps).values({ runId: run.id, brandId: run.brandId, stepKey: step.key, status: "failed", error: message });
          run = await update(run, { status: "running", attempts, nextAt: new Date(now.getTime() + attempts * 10 * 60_000), summary: `${step.name} failed; retrying.` });
        }
        break;
      }

      const usage = result.outcome === "done" ? result.usage ?? null : null;
      report.steps.push({ key: step.key, outcome: result.outcome, summary: result.summary, usage });
      const context = { ...run.context };
      if (retry) delete context.retryStep;
      const base = { attempts: 0, context, summary: result.summary };

      switch (result.outcome) {
        case "done": {
          const merged = { ...context, ...(result.context ?? {}) };
          const subject = result.subject ? { subjectType: result.subject.type, subjectId: result.subject.id } : {};
          const waiting = await openPause(run.id, step.key);
          if (waiting) await decideRow(waiting.id, "done", null, null);

          const reasons = [...(result.reasons ?? [])];
          const output: Record<string, unknown> = { ...(result.output ?? {}) };
          // Everything an agent makes is read by the reviewer before it can go anywhere.
          if (step.performer === "agent" && result.review) {
            const checked = await review(brand, run, result.review);
            output.review = checked.record;
            // Weak but not risky: the agent gets one go at the reviewer's fixes
            // before a person is asked to spend time on it.
            const v = checked.record;
            if (isVerdict(v) && v.flags.length === 0 && reasons.length === 0 && v.score < brand.reviewThreshold
              && !context.autoRevised && v.fixes.length > 0) {
              await db.insert(workflowRunSteps).values({
                runId: run.id, brandId: run.brandId, stepKey: step.key, status: "done", output, usage,
                summary: `Reviewer scored it ${v.score}/100; the agent is redoing it with the reviewer's fixes.`,
              });
              run = await update(run, {
                ...base, ...subject, context: { ...merged, autoRevised: true }, status: "running", nextAt: now,
                feedback: `An editor reviewed this and scored it ${v.score}/100: ${v.summary}\nFix:\n${v.fixes.map((f) => `- ${f}`).join("\n")}`,
              });
              break;
            }
            reasons.push(...checked.reasons);
          }
          const reviewing = !result.byHuman && (await reviewOn(run.brandId, run.workflowCode, step.key));
          if (reviewing || reasons.length) {
            await pauseStep(run, step.key, {
              kind: reasons.length ? "safety" : "review",
              question: result.question ?? step.reviewQuestion ?? "Check this, then approve it.",
              reasons: reasons.length ? reasons : ["Review is on for this step."],
              href: result.href, after: true,
              sendBackTo: step.performer === "agent" ? step.key : null,
            }, { summary: result.summary, output, usage });
            run = await update(run, { ...base, ...subject, context: merged, feedback: null, status: "waiting_review", nextAt: null });
          } else {
            await db.insert(workflowRunSteps).values({
              runId: run.id, brandId: run.brandId, stepKey: step.key, status: "done",
              summary: result.summary, output, usage,
            });
            run = await update(run, { ...base, ...subject, context: merged, feedback: null, status: "running", stepIndex: run.stepIndex + 1, nextAt: now });
          }
          break;
        }
        case "skip":
          await db.insert(workflowRunSteps).values({ runId: run.id, brandId: run.brandId, stepKey: step.key, status: "skipped", summary: result.summary });
          run = await update(run, { ...base, status: "running", stepIndex: run.stepIndex + 1, nextAt: now });
          break;
        case "wait":
          run = await update(run, { ...base, status: "waiting", nextAt: result.until });
          break;
        case "human": {
          const waiting = await openPause(run.id, step.key);
          if (!waiting) {
            await pauseStep(run, step.key, {
              kind: "human", question: result.question, reasons: [result.summary], href: result.href, after: false, sendBackTo: null,
            }, { summary: result.summary });
          }
          run = await update(run, { ...base, status: "waiting_human", nextAt: result.recheckAt });
          break;
        }
        case "stop": {
          const waiting = await openPause(run.id, step.key);
          if (waiting) await decideRow(waiting.id, "superseded", null, null);
          await pauseStep(run, step.key, {
            kind: "safety", question: result.question, reasons: result.reasons, href: result.href, after: false, sendBackTo: result.sendBackTo,
          }, { summary: result.summary });
          run = await update(run, { ...base, feedback: null, status: "waiting_review", nextAt: null });
          break;
        }
        case "cancel":
          await db.insert(workflowRunSteps).values({ runId: run.id, brandId: run.brandId, stepKey: step.key, status: "done", summary: result.summary });
          run = await update(run, { ...base, status: "cancelled", nextAt: null, finishedAt: new Date() });
          break;
      }
    }
    report.run = run;
    return report;
  } finally {
    await db.update(workflowRuns).set({ leaseUntil: null }).where(eq(workflowRuns.id, runId));
  }
}

async function update(run: WorkflowRun, patch: Partial<typeof workflowRuns.$inferInsert>) {
  const [row] = await db.update(workflowRuns).set({ ...patch, updatedAt: new Date() }).where(eq(workflowRuns.id, run.id)).returning();
  return row;
}

async function pauseStep(run: WorkflowRun, stepKey: string, pause: Pause, extra: {
  summary?: string; output?: Record<string, unknown>; usage?: StepResultUsage; error?: string;
}) {
  await db.insert(workflowRunSteps).values({
    runId: run.id, brandId: run.brandId, stepKey, status: "paused", pause,
    summary: extra.summary ?? null, output: extra.output ?? {}, usage: extra.usage ?? null, error: extra.error ?? null,
  });
}

async function decideRow(rowId: string, decision: StepDecision, userId: string | null, note: string | null) {
  await db.update(workflowRunSteps).set({ decision, decidedBy: userId, decidedAt: new Date(), note })
    .where(eq(workflowRunSteps.id, rowId));
}

/* ------------------------------------------------------------- decisions */

export type Decision = "approve" | "send_back" | "reject" | "done";

/**
 * A person's answer to a paused step. Checks the run is still waiting on
 * exactly this pause, applies the decision, then moves the run on as far as
 * it can go without an agent. Returns a line for the person.
 */
export async function decide(input: { stepId: string; decision: Decision; note: string | null; userId: string }): Promise<string> {
  const row = await db.query.workflowRunSteps.findFirst({ where: eq(workflowRunSteps.id, input.stepId) });
  if (!row || row.status !== "paused" || row.decision || !row.pause) throw new Error("This is no longer waiting for a decision.");
  const run = await db.query.workflowRuns.findFirst({ where: eq(workflowRuns.id, row.runId) });
  if (!run || !["waiting_review", "waiting_human"].includes(run.status)) throw new Error("This run has already moved on.");
  const def = WORKFLOW_BY_CODE[run.workflowCode];
  const at = def.steps.findIndex((s) => s.key === row.stepKey);
  if (at !== run.stepIndex) throw new Error("This run has already moved on.");
  const pause = row.pause;
  const note = input.note?.trim() || null;
  const now = new Date();

  switch (input.decision) {
    case "approve": {
      if (pause.kind === "human") throw new Error("This one is a task for a person: do it, then mark it done.");
      await decideRow(row.id, "approved", input.userId, note);
      await db.update(workflowRuns).set(pause.after
        ? { status: "running", stepIndex: run.stepIndex + 1, nextAt: now, updatedAt: now }
        : { status: "running", nextAt: now, context: { ...run.context, retryStep: row.stepKey }, updatedAt: now },
      ).where(eq(workflowRuns.id, run.id));
      const report = await advance(run.id, { agentSteps: false, now });
      return describe(report, pause.after ? "Approved." : "Retried.");
    }
    case "send_back": {
      if (!pause.sendBackTo) throw new Error("This step cannot be sent back. Fix it where it lives, then retry it.");
      if (!note) throw new Error("Say what to change, so the agent can fix it.");
      if (run.revisions >= MAX_REVISIONS) {
        throw new Error(`This has been sent back ${MAX_REVISIONS} times. Edit it yourself, then approve it.`);
      }
      const to = def.steps.findIndex((s) => s.key === pause.sendBackTo);
      await decideRow(row.id, "sent_back", input.userId, note);
      await db.update(workflowRuns).set({
        status: "running", stepIndex: to, feedback: note, revisions: run.revisions + 1, nextAt: now,
        summary: "Sent back with a note; the agent will redo it.", updatedAt: now,
      }).where(eq(workflowRuns.id, run.id));
      await implFor(run.workflowCode).onSendBack?.(run, input.userId, note);
      return "Sent back. The agent redoes it on its next run, within a few minutes.";
    }
    case "reject": {
      await decideRow(row.id, "rejected", input.userId, note);
      await db.update(workflowRuns).set({
        status: "cancelled", nextAt: null, finishedAt: now, summary: `Stopped by a person${note ? `: ${note}` : "."}`, updatedAt: now,
      }).where(eq(workflowRuns.id, run.id));
      await implFor(run.workflowCode).onReject?.(run, input.userId, note);
      return "Stopped. Nothing from this run will go out.";
    }
    case "done": {
      if (pause.kind !== "human") throw new Error("Approve or send this back instead.");
      await db.update(workflowRuns).set({ status: "running", nextAt: now, context: { ...run.context, retryStep: row.stepKey }, updatedAt: now })
        .where(eq(workflowRuns.id, run.id));
      const report = await advance(run.id, { agentSteps: false, now });
      // Done means this task was closed — the step may well stop again for something new, like a review.
      const task = report && (await db.query.workflowRunSteps.findFirst({ where: eq(workflowRunSteps.id, row.id) }));
      if (task && !task.decision) throw new Error(`Not done yet: ${report!.run.summary ?? task.summary}`);
      return describe(report, "Marked done.");
    }
  }
}

function describe(report: AdvanceReport | null, lead: string) {
  if (!report) return `${lead} Another worker has the run right now; it carries on from there.`;
  const s = report.run.status;
  if (s === "done") return `${lead} The run is finished.`;
  if (s === "waiting_review" || s === "waiting_human") return `${lead} It has stopped again for a person: ${report.run.summary ?? ""}`.trim();
  return `${lead} ${report.run.summary ?? "It carries on by itself."}`;
}

/**
 * The same decision made somewhere other than the inbox — a post approved or
 * sent back on its own page. Keeps the run in step with what the person did.
 */
export async function syncSubjectReview(input: {
  subjectType: string; subjectId: string; stepKey: string; decision: "approve" | "send_back"; note: string | null; userId: string;
}) {
  const run = await runForSubject(input.subjectType, input.subjectId);
  if (!run || run.status !== "waiting_review") return;
  const row = await openPause(run.id, input.stepKey);
  if (!row?.pause) return;
  const now = new Date();
  if (input.decision === "approve") {
    await decideRow(row.id, "approved", input.userId, input.note);
    await db.update(workflowRuns).set({
      status: "running", nextAt: now, updatedAt: now,
      ...(row.pause.after ? { stepIndex: run.stepIndex + 1 } : { context: { ...run.context, retryStep: row.stepKey } }),
    }).where(eq(workflowRuns.id, run.id));
    await advance(run.id, { agentSteps: false, now });
    return;
  }
  // Past the limit, the agent leaves it to the person: the pause stays open for their approval.
  if (!row.pause.sendBackTo || run.revisions >= MAX_REVISIONS) return;
  const def = WORKFLOW_BY_CODE[run.workflowCode];
  await decideRow(row.id, "sent_back", input.userId, input.note);
  await db.update(workflowRuns).set({
    status: "running", stepIndex: def.steps.findIndex((s) => s.key === row.pause!.sendBackTo),
    feedback: input.note, revisions: run.revisions + 1, nextAt: now, updatedAt: now,
    summary: "Sent back with a note; the agent will redo it.",
  }).where(eq(workflowRuns.id, run.id));
}

/* ------------------------------------------------------------------ tick */

/**
 * The scheduled tick: every open run that is due moves forward, oldest
 * first, until the time budget is spent. Agent steps need Claude; without a
 * key the rest of the work (scheduling, watching the publish) still runs.
 */
export async function runDueWorkflows(now = new Date(), budgetMs = 90_000) {
  const started = Date.now();
  const due = await db.select({ id: workflowRuns.id }).from(workflowRuns)
    .where(and(
      inArray(workflowRuns.status, ["running", "waiting", "waiting_human"]),
      lte(workflowRuns.nextAt, now),
      or(isNull(workflowRuns.leaseUntil), lt(workflowRuns.leaseUntil, now)),
    ))
    .orderBy(asc(workflowRuns.nextAt))
    .limit(100);

  const agentSteps = draftingConfigured();
  const moved: { runId: string; status: string; summary: string | null }[] = [];
  for (const { id } of due) {
    if (Date.now() - started > budgetMs) break;
    const report = await advance(id, { agentSteps, now });
    if (report && report.steps.length) moved.push({ runId: id, status: report.run.status, summary: report.run.summary });
  }
  return { due: due.length, moved };
}

/* --------------------------------------------------------------- reading */

/** The review inbox: every open pause on these brands, oldest first. */
export async function getOpenPauses(brandIds: string[]) {
  if (brandIds.length === 0) return [];
  return db.select({ step: workflowRunSteps, run: workflowRuns }).from(workflowRunSteps)
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowRunSteps.runId))
    .where(and(
      inArray(workflowRunSteps.brandId, brandIds),
      eq(workflowRunSteps.status, "paused"),
      isNull(workflowRunSteps.decision),
      inArray(workflowRuns.status, ["waiting_review", "waiting_human"]),
    ))
    .orderBy(asc(workflowRunSteps.createdAt));
}

export async function countOpenPauses(brandIds: string[]) {
  if (brandIds.length === 0) return 0;
  const [row] = await db.select({ n: count() }).from(workflowRunSteps)
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowRunSteps.runId))
    .where(and(
      inArray(workflowRunSteps.brandId, brandIds),
      eq(workflowRunSteps.status, "paused"),
      isNull(workflowRunSteps.decision),
      inArray(workflowRuns.status, ["waiting_review", "waiting_human"]),
    ));
  return row.n;
}

export async function getRecentRuns(brandIds: string[], limit = 40) {
  if (brandIds.length === 0) return [];
  return db.select().from(workflowRuns).where(inArray(workflowRuns.brandId, brandIds))
    .orderBy(desc(workflowRuns.updatedAt)).limit(limit);
}

/* -------------------------------------------------------------- reviewer */

/**
 * The reviewer's read of one agent step. Its flags and a score below the
 * brand's threshold become safety reasons. When it cannot run — the budget
 * is spent, the API is down — nobody has read the work, so that is a safety
 * reason too, and the word screen says what the person should look for.
 */
async function review(brand: Brand, run: WorkflowRun, input: NonNullable<Extract<StepResult, { outcome: "done" }>["review"]>) {
  try {
    await assertBudget(brand);
    const verdict = await reviewWork({ brand, kind: input.kind, text: input.text, source: `review:${run.workflowCode}` });
    return { record: verdict as ReviewRecord, reasons: verdictReasons(verdict, brand.reviewThreshold) };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      record: { skipped: why } as ReviewRecord,
      reasons: [`The reviewer could not read this, so a person checks it. ${why}`, ...screenCopy(input.screen)],
    };
  }
}

/**
 * A person dealt with the subject some other way — closed the comment in
 * Engagement, say. Its open run stops, and anything it was waiting on in the
 * Review inbox goes with it.
 */
export async function closeRunFor(subjectType: string, subjectId: string, summary: string) {
  const run = await runForSubject(subjectType, subjectId);
  if (!run) return;
  const now = new Date();
  await db.update(workflowRunSteps).set({ decision: "superseded", decidedAt: now })
    .where(and(eq(workflowRunSteps.runId, run.id), eq(workflowRunSteps.status, "paused"), isNull(workflowRunSteps.decision)));
  await db.update(workflowRuns).set({ status: "cancelled", nextAt: null, finishedAt: now, summary, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
}

/**
 * Something a run was waiting on happened elsewhere — a person posted the
 * reply by hand and marked it replied. An approval still due is given, and a
 * run waiting on a person looks again now rather than at its next check.
 */
export async function nudgeRunFor(subjectType: string, subjectId: string, stepKey: string, userId: string) {
  await syncSubjectReview({ subjectType, subjectId, stepKey, decision: "approve", note: null, userId });
  const run = await runForSubject(subjectType, subjectId);
  if (!run || run.status !== "waiting_human") return;
  const step = WORKFLOW_BY_CODE[run.workflowCode]?.steps[run.stepIndex];
  await db.update(workflowRuns).set({ status: "running", nextAt: new Date(), context: { ...run.context, retryStep: step?.key }, updatedAt: new Date() })
    .where(eq(workflowRuns.id, run.id));
  await advance(run.id, { agentSteps: false });
}
