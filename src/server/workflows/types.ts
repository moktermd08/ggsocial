import type { brands, workflowRuns } from "@/lib/db";
import type { AgentUsage } from "@/lib/agents/meta";
import type { StepDef } from "@/lib/workflows/meta";

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type Brand = typeof brands.$inferSelect;

export type StepContext = {
  run: WorkflowRun;
  brand: Brand;
  step: StepDef;
  /** A person's note from "send back", when this step is being redone for it. */
  feedback: string | null;
  /** True when a person pressed "check again" or "retry" on this step. */
  retry: boolean;
  now: Date;
};

/**
 * What a step handler reports. The engine — not the handler — decides whether
 * the run then stops for a person, from the brand's review setting and the
 * safety reasons the handler found.
 */
export type StepResult =
  /** The step's work is done. `reasons` are safety stops found in it. */
  | {
      outcome: "done";
      summary: string;
      output?: Record<string, unknown>;
      usage?: AgentUsage | null;
      subject?: { type: string; id: string };
      context?: Record<string, unknown>;
      reasons?: string[];
      question?: string;
      href?: string;
      /** A person did this step, so there is nothing of an agent's to review. */
      byHuman?: boolean;
    }
  | { outcome: "skip"; summary: string }
  /** Nothing to do yet: look again at `until`. */
  | { outcome: "wait"; summary: string; until: Date }
  /** A person has to do this step. The engine looks again at `recheckAt`. */
  | { outcome: "human"; summary: string; question: string; href?: string; recheckAt: Date }
  /** Blocked: a person must fix something before the step can finish. */
  | { outcome: "stop"; summary: string; reasons: string[]; question: string; href?: string; sendBackTo: string | null }
  /** The work no longer makes sense (its post was deleted, say). */
  | { outcome: "cancel"; summary: string };

export type WorkflowImpl = {
  handlers: Record<string, (ctx: StepContext) => Promise<StepResult>>;
  /** Tidies the subject when a person rejects the run outright. */
  onReject?: (run: WorkflowRun, userId: string, note: string | null) => Promise<void>;
  /** Marks the subject as sent back, before the step re-runs. */
  onSendBack?: (run: WorkflowRun, userId: string, note: string) => Promise<void>;
};
