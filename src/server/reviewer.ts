import "server-only";
import { z } from "zod";
import type { brands } from "@/lib/db";
import { REVIEW_FLAGS, REVIEW_FLAG_LABELS, type ReviewFlag, type ReviewVerdict } from "@/lib/workflows/review";
import { askClaude } from "@/server/agents/claude";

/**
 * The reviewer: a second, cheap pair of eyes on everything an agent makes
 * before it can go anywhere. It scores the work against the brand book and
 * the house rules, and raises the risks a person must always see. It never
 * edits anything — its verdict decides whether the run stops for a person.
 */

const SYSTEM = `You review work a brand's AI agent produced — a social post, a reply — before it can go out in the brand's name. You never rewrite it; you judge it.

Score it from 0 to 100 for whether it can go out exactly as it is:
- 90+: on-brand, accurate as far as you can tell, follows the house rules, nothing a careful editor would change.
- 75–89: fine to go out; small things you would polish.
- 50–74: a person should look before it goes: off-voice, vague, weak hook, a rule half-followed.
- below 50: should not go out: wrong, confusing, off-brand or against a rule.

Raise every risk flag that applies, even when the work is otherwise good — these always go to a person:
- price_or_offer: states or implies a price, discount, offer, promo code or free trial.
- refund_or_guarantee: promises a refund, guarantee, warranty or anything contractual.
- legal: legal matters, liability, compliance, regulation, lawsuits.
- health_claim: medical, health or safety claims.
- admits_fault: apologises for the brand or admits a mistake.
- complaint_or_crisis: responds to a complaint, outage, incident, or anything that could escalate.
- sensitive_topic: politics, religion, tragedy, identity, or anything people could reasonably find offensive.
- unverifiable_claim: a statistic, result or superlative you cannot check against the brand book.
Flag only what the work actually does. Mentioning a product is not an offer.`;

const VerdictSchema = z.object({
  score: z.number().int().min(0).max(100),
  flags: z.array(z.enum(REVIEW_FLAGS)),
  summary: z.string().describe("One sentence for the person who reads this: why the score."),
  fixes: z.array(z.string()).describe("The changes that would raise the score, most important first. Empty when none."),
});

export async function reviewWork(opts: {
  brand: typeof brands.$inferSelect;
  /** What it is: "a social post", "a reply to a comment". */
  kind: string;
  /** The work itself, and anything the reviewer needs to judge it — the channels, the rules it follows. */
  text: string;
  source: string;
}): Promise<ReviewVerdict> {
  const { output, usage } = await askClaude({
    schema: VerdictSchema, system: SYSTEM, brand: opts.brand, job: "review", source: opts.source, maxTokens: 2_000,
    task: `Review this ${opts.kind}:\n\n${opts.text}`,
  });
  const flags = [...new Set(output.flags)] as ReviewFlag[];
  return {
    score: output.score, flags, summary: output.summary, fixes: output.fixes.slice(0, 5),
    model: usage.model, reviewedAt: new Date().toISOString(),
  };
}

/** The safety reasons a verdict raises for a brand's threshold. */
export function verdictReasons(v: ReviewVerdict, threshold: number) {
  const reasons = v.flags.map((f) => `Reviewer: ${REVIEW_FLAG_LABELS[f]}.`);
  if (v.score < threshold) reasons.push(`Reviewer scored it ${v.score}/100, below this brand's ${threshold}: ${v.summary}`);
  return reasons;
}
