import type { brandAgents, brands } from "@/lib/db";
import type { AgentRunItem, AgentUsage } from "@/lib/agents/meta";

/** One agent about to work one brand. */
export type AgentJob = {
  brand: typeof brands.$inferSelect;
  config: typeof brandAgents.$inferSelect;
  /** A tighter cap for a "Run now" inside a web request. */
  limit?: number;
  now: Date;
};

/** What a run reports back, for the run log. */
export type AgentOutcome = {
  summary: string;
  items: AgentRunItem[];
  issues: string[];
  usage: AgentUsage | null;
};
