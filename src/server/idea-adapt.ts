import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, brands, contentIdeas, ideaVersions } from "@/lib/db";
import { ideaColumns, ideaValues } from "@/lib/ideas";
import { askClaude } from "@/server/agents/claude";
import { audienceOf } from "@/server/ideas";
import type { AgentUsage } from "@/lib/agents/meta";

/**
 * One idea, told by several brands, must not be told the same way. When an
 * idea reaches more than one brand, each brand's writer gets its own take on
 * it before drafting: same insight, the brand's own angle, voice and hook.
 * The take is saved as the brand's version of the idea, where a person can see
 * and change it like any other.
 */

const AdaptSchema = z.object({
  angle: z.string().describe("In a sentence: how this brand tells it, and what makes that different from how other brands would."),
  title: z.string().describe("A short working title for this brand's take."),
  problem: z.string().describe("The problem, as this brand's own audience lives it."),
  action: z.string().describe("What this brand does about it, concretely."),
  outcome: z.string().describe("The result, in this brand's terms. No invented figures."),
  tone: z.string().describe("One or two words."),
});

const SYSTEM = `You adapt one content idea for one brand. The same idea is going to several brands, and each must tell it in its own way.

Keep the underlying insight. Change the framing: the audience's situation, the example, the hook, the voice, so it reads as this brand's own and could not be mistaken for a sibling brand's post. Use only facts the brand book supports; never invent statistics, clients or prices. Do not copy how the other brands are telling it.`;

/**
 * Gives this brand its own take on a shared idea, once. Returns the usage of
 * the call, or null when nothing was needed (the idea is only this brand's, or
 * the brand already has its version). A failed call leaves the idea as written.
 */
export async function adaptIdeaForBrand(ideaId: string, brandId: string): Promise<AgentUsage | null> {
  const [idea, brand] = await Promise.all([
    db.query.contentIdeas.findFirst({ where: eq(contentIdeas.id, ideaId) }),
    db.query.brands.findFirst({ where: eq(brands.id, brandId) }),
  ]);
  if (!idea || !brand) return null;
  const audience = await audienceOf(idea);
  if (audience.length < 2) return null;
  const versions = await db.select().from(ideaVersions).where(eq(ideaVersions.ideaId, ideaId));
  if (versions.some((v) => v.brandId === brandId)) return null;

  const others = await db.select({ id: brands.id, name: brands.name }).from(brands);
  const taken = versions.filter((v) => v.angle).map((v) => `- ${others.find((o) => o.id === v.brandId)?.name ?? "Another brand"}: ${v.angle}`);
  const task = [
    `Brand: ${brand.name}`,
    `The idea as written:`,
    `Problem: ${idea.problem}`,
    idea.action ? `What gets done: ${idea.action}` : "",
    idea.outcome ? `Outcome: ${idea.outcome}` : "",
    idea.tone ? `Tone: ${idea.tone}` : "",
    idea.notes ? `Planning notes: ${idea.notes}` : "",
    audience.length > 1 ? `\nIt is going to ${audience.length} brands, including this one.` : "",
    taken.length ? `Angles already taken by the others (take a different one):\n${taken.join("\n")}` : "",
  ].filter(Boolean).join("\n");

  try {
    const { output, usage } = await askClaude({ schema: AdaptSchema, system: SYSTEM, brand, task, source: "workflow:adapt-idea", effort: "low", maxTokens: 2_000 });
    const base = ideaValues(idea);
    const adapted = { ...base, title: output.title, problem: output.problem, action: output.action, outcome: output.outcome, tone: output.tone };
    await db.insert(ideaVersions).values({
      ideaId, brandId, masterSnapshot: base, ...ideaColumns(adapted), problem: output.problem, angle: output.angle,
      notes: "Adapted for this brand by the content writer.",
    }).onConflictDoNothing();
    return usage;
  } catch (err) {
    // The idea goes out as written rather than not at all.
    console.error(`[idea-adapt] ${brand.name}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
