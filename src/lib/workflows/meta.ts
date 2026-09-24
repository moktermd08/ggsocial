/**
 * Workflows, importable from client components without pulling in drizzle.
 *
 * Every kind of work runs as a workflow: a fixed list of steps, each done by
 * an agent, a tool or a person. After an agent's step the run stops for a
 * person only where that step's review is on — and review is on for every
 * step until a brand owner switches it off. Safety stops (see `safety.ts`)
 * pause a run whatever the setting says.
 *
 * The steps are defined here in code because each one is code: a handler in
 * `src/server/workflows`. What a brand can change is only whether a person
 * reviews a step.
 */

export const WORKFLOW_CODES = ["publish-post"] as const;
export type WorkflowCode = (typeof WORKFLOW_CODES)[number];

export type StepPerformer = "agent" | "tool" | "human";

export type StepDef = {
  key: string;
  name: string;
  performer: StepPerformer;
  /** What the step does, in one line for the settings page. */
  does: string;
  /** True where a person can be asked to review the step's result. */
  reviewable: boolean;
  /** What the reviewer is deciding, when the step stops for review. */
  reviewQuestion?: string;
};

export type WorkflowDef = {
  code: WorkflowCode;
  name: string;
  summary: string;
  /** The agent that starts runs of it, when an agent does. */
  startedBy: string;
  /** The activity checklist rows a run carries out. */
  activityCodes: string[];
  steps: StepDef[];
};

export const WORKFLOWS: WorkflowDef[] = [
  {
    code: "publish-post",
    name: "Publish a planned post",
    summary: "From the next idea in the content plan to a published post: written, checked against the playbook, scheduled and posted.",
    startedBy: "Content writer agent, hourly, for each open posting slot",
    activityCodes: ["D-01"],
    steps: [
      {
        key: "draft", name: "Write the post", performer: "agent", reviewable: true,
        does: "Takes the next idea and an open slot, writes it for every channel to the brand book and playbook, and checks its own copy.",
        reviewQuestion: "Approve this post, or send it back with a note.",
      },
      {
        key: "media", name: "Add media", performer: "human", reviewable: false,
        does: "Where the idea or a channel needs an image or video, a person attaches it. Skipped when the post needs none.",
      },
      {
        key: "schedule", name: "Schedule", performer: "tool", reviewable: false,
        does: "Checks the playbook's must-rules and placeholders one last time, then books every channel for the slot.",
      },
      {
        key: "publish", name: "Publish", performer: "tool", reviewable: false,
        does: "Live channels post by themselves at the slot. Manual channels wait in the publish queue for a person.",
      },
    ],
  },
];

export const WORKFLOW_BY_CODE = Object.fromEntries(WORKFLOWS.map((w) => [w.code, w])) as Record<WorkflowCode, WorkflowDef>;

export function isWorkflowCode(v: unknown): v is WorkflowCode {
  return typeof v === "string" && (WORKFLOW_CODES as readonly string[]).includes(v);
}

export function stepDef(code: WorkflowCode, key: string) {
  return WORKFLOW_BY_CODE[code].steps.find((s) => s.key === key);
}

/* ----------------------------------------------------------------- runs */

export const RUN_STATUSES = ["running", "waiting", "waiting_review", "waiting_human", "done", "cancelled", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_META: Record<RunStatus, { label: string; color: string }> = {
  running: { label: "Working", color: "#4f46e5" },
  waiting: { label: "Waiting", color: "#8b8b96" },
  waiting_review: { label: "Needs review", color: "#b45309" },
  waiting_human: { label: "Needs a person", color: "#b45309" },
  done: { label: "Done", color: "#15803d" },
  cancelled: { label: "Stopped", color: "#8b8b96" },
  failed: { label: "Failed", color: "#b91c1c" },
};

/** Why a run stopped for a person. */
export type PauseKind = "review" | "safety" | "human";

export const PAUSE_META: Record<PauseKind, { label: string; color: string }> = {
  review: { label: "Review", color: "#4f46e5" },
  safety: { label: "Safety stop", color: "#b91c1c" },
  human: { label: "Your turn", color: "#b45309" },
};

export type Pause = {
  kind: PauseKind;
  /** What the person is deciding or doing, in one sentence. */
  question: string;
  /** Why it stopped: the safety reasons, or "review is on for this step". */
  reasons: string[];
  /** Where to go to review or do it. */
  href?: string;
  /**
   * True when the step's own work is done and approving moves on to the
   * next step; false when the step is blocked and approving re-runs it.
   */
  after: boolean;
  /** The step a "send back" re-runs with the person's note. null = cannot be sent back. */
  sendBackTo: string | null;
};

export const STEP_DECISIONS = ["approved", "sent_back", "rejected", "done", "superseded"] as const;
export type StepDecision = (typeof STEP_DECISIONS)[number];

/** How many times a person can send a run back before they must fix it themselves. */
export const MAX_REVISIONS = 3;
/** How many times a step may fail in a row before it stops for a person. */
export const MAX_ATTEMPTS = 3;
