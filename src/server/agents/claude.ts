import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { brands } from "@/lib/db";
import type { AgentUsage } from "@/lib/agents/meta";
import { MODELS, brandBook, client, explain, fallbackFor, DraftingError, type ModelJob } from "@/server/drafting";
import { recordUsage } from "@/server/ai-usage";

/**
 * One structured answer from Claude for an agent: a fixed instruction block,
 * the brand book (cached per brand, same as drafting), and the task. Throws
 * DraftingError with a message a person can act on. Every call is written to
 * the spend ledger under `source`, whether or not its answer is usable.
 */
export async function askClaude<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  brand: typeof brands.$inferSelect;
  task: string;
  effort?: "low" | "medium" | "high";
  /** Which job this is, for the model that does it. Replies are writing; reports are analysis. */
  job?: ModelJob;
  /** Who asked, for the spend ledger: "agent:community", say. */
  source: string;
  maxTokens?: number;
}): Promise<{ output: z.infer<S>; usage: AgentUsage }> {
  const api = client();
  const model = MODELS[opts.job ?? "writing"];
  // Haiku takes no effort setting; the others default to medium.
  const effort = model.startsWith("claude-haiku") ? {} : { effort: opts.effort ?? "medium" };
  try {
    const res = await api.beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 16_000,
      // On Opus, a declined request is retried on a fallback model inside the same call.
      ...fallbackFor(model),
      output_config: { ...effort, format: betaZodOutputFormat(opts.schema) },
      system: [
        { type: "text", text: opts.system },
        { type: "text", text: brandBook(opts.brand), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: opts.task }],
    } satisfies Parameters<Anthropic["beta"]["messages"]["parse"]>[0]);

    const usage: AgentUsage = {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      model: res.model,
    };
    await recordUsage(opts.brand.id, opts.source, usage);

    if (res.stop_reason === "refusal") throw new DraftingError("Claude declined this one.");
    if (res.stop_reason === "max_tokens") throw new DraftingError("Claude ran out of room before it finished.");
    if (!res.parsed_output) throw new DraftingError("Claude's answer could not be read.");
    return { output: res.parsed_output as z.infer<S>, usage };
  } catch (err) {
    explain(err);
  }
}

export function addUsage(total: AgentUsage | null, u: AgentUsage): AgentUsage {
  if (!total) return { ...u };
  return {
    input: total.input + u.input, output: total.output + u.output,
    cacheRead: total.cacheRead + u.cacheRead, cacheWrite: total.cacheWrite + u.cacheWrite, model: u.model,
  };
}
