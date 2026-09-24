import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, activity, channels, interactions, posts } from "@/lib/db";
import { INTERACTION_KIND_LABELS } from "@/lib/db/engagement";
import { platformOrNull } from "@/lib/platforms";
import { truncate } from "@/lib/format";
import { getBrandPlaybook } from "@/server/playbook";
import { askClaude } from "@/server/agents/claude";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The community manager: drafts a reply to each new inbound comment, message,
 * mention and review, and sorts it by tone and urgency. The reply waits in the
 * engagement queue; a person reads it, edits it and sends it.
 */

const KINDS = ["comment", "reply", "mention", "message", "review", "lead"] as const;

const SYSTEM = `You are the first line of a brand's community team. For each item below — a comment, message, mention or review someone left the brand — you draft the reply a person on the team will read, edit if needed and send.

What good looks like:
- Answer the actual point in the brand's voice, briefly, as a person would. Add something; where it fits, end with one question that keeps the conversation going.
- Never promise a price, a discount, a deadline, a refund or anything contractual, and never admit fault. Offer to take it to a private channel instead, and set handToPerson.
- Complaints, anger, legal or safety concerns, press, and anything personal or sensitive: acknowledge calmly, move it to a private channel, set priority high and handToPerson.
- Spam, abuse and bots: no reply (empty string), and say so in the note.
- A message or lead showing buying intent: qualify it with one question (need, timing or budget) and mark priority high.
- Never repeat the same wording across replies. Never use a banned word; follow the emoji policy exactly.
- The note is for the team: one line on what you did and anything they must check.`;

const ReplySchema = z.object({
  replies: z.array(z.object({
    id: z.string(),
    reply: z.string().describe("The reply to send, or an empty string when none should be sent."),
    sentiment: z.enum(["positive", "neutral", "negative", "question"]),
    priority: z.enum(["low", "normal", "high"]),
    handToPerson: z.boolean().describe("True when a person must decide, not just proofread."),
    note: z.string(),
  })),
});

const EMOJI = /\p{Extended_Pictographic}/u;

function num(v: unknown, fallback: number, min: number, max: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export async function runCommunity(job: AgentJob): Promise<AgentOutcome> {
  const { brand, config } = job;
  const perRun = job.limit ?? num(config.settings?.perRun, 10, 1, 25);
  const out: AgentOutcome = { summary: "", items: [], issues: [], usage: null };

  const rows = await db.select({ i: interactions, platform: channels.platform, postTitle: posts.title })
    .from(interactions)
    .leftJoin(channels, eq(channels.id, interactions.channelId))
    .leftJoin(posts, eq(posts.id, interactions.postId))
    .where(and(
      eq(interactions.brandId, brand.id),
      eq(interactions.status, "new"),
      eq(interactions.direction, "inbound"),
      inArray(interactions.kind, [...KINDS]),
      isNull(interactions.replyBody),
    ))
    .orderBy(asc(interactions.dueAt), asc(interactions.receivedAt))
    .limit(perRun);

  if (rows.length === 0) {
    out.summary = "No new comments, messages or reviews waiting.";
    return out;
  }

  // The playbook's rules for this kind of work, as this brand has tuned them.
  const playbook = await getBrandPlaybook(brand.id);
  const rules = playbook.filter((r) => r.enabled && ["reply", "dm", "review-reply", "leads"].includes(r.code));

  const task = [
    rules.length ? "House rules for this work:" : "",
    ...rules.map((r) => `- ${r.name}: ${r.instructions}${r.brandNotes ? ` For this brand: ${r.brandNotes}` : ""}`),
    config.guidelines?.trim() ? `\nStanding guidelines from the brand's team (follow these):\n${config.guidelines.trim()}` : "",
    `\nThe brand aims to answer within ${brand.replySlaMinutes} minutes.`,
    "\nItems (return one reply per id, same ids):",
    ...rows.map(({ i, platform, postTitle }) => [
      `- id: ${i.id}`,
      `  kind: ${INTERACTION_KIND_LABELS[i.kind]}${platform ? ` on ${platformOrNull(platform)?.name ?? platform}` : ""}`,
      i.authorName || i.authorHandle ? `  from: ${[i.authorName, i.authorHandle].filter(Boolean).join(" ")}${i.authorReach ? ` (${i.authorReach} followers)` : ""}` : "",
      postTitle ? `  on our post: ${postTitle}` : "",
      `  said: ${i.body.replace(/\s+/g, " ").trim()}`,
    ].filter(Boolean).join("\n")),
  ].filter((l) => l !== "").join("\n");

  const { output, usage } = await askClaude({ schema: ReplySchema, system: SYSTEM, brand, task });
  out.usage = usage;

  const banned = brand.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  let drafted = 0, flagged = 0, silent = 0;
  for (const { i, platform } of rows) {
    const r = output.replies.find((x) => x.id === i.id);
    if (!r) { out.issues.push(`No draft came back for ${truncate(i.body, 40)}.`); continue; }

    // Checked in code, as drafting does: a draft that breaks a house rule is flagged, not hidden.
    const problems: string[] = [];
    const lower = r.reply.toLowerCase();
    for (const w of banned) if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) problems.push(`uses the banned word "${w}"`);
    if (brand.emojiPolicy === "none" && EMOJI.test(r.reply)) problems.push("uses emoji");
    const max = platform ? platformOrNull(platform)?.constraints.textMax : undefined;
    if (max && r.reply.length > max) problems.push(`${r.reply.length} characters, over the ${max} limit`);

    const needsPerson = r.handToPerson || problems.length > 0;
    const note = [
      `Community agent: ${r.note}`,
      needsPerson ? "A person must decide this one before anything is sent." : "",
      problems.length ? `Draft ${problems.join("; ")}.` : "",
    ].filter(Boolean).join(" ");

    await db.update(interactions).set({
      replyBody: r.reply.trim() || null,
      agentCode: r.reply.trim() ? "community" : null,
      sentiment: r.sentiment,
      priority: needsPerson ? "high" : r.priority,
      status: "in_progress",
      notes: [i.notes, note].filter(Boolean).join("\n"),
      updatedAt: new Date(),
    }).where(eq(interactions.id, i.id));

    if (!r.reply.trim()) silent++;
    else drafted++;
    if (needsPerson) {
      flagged++;
      out.issues.push(`${INTERACTION_KIND_LABELS[i.kind]} from ${i.authorName ?? i.authorHandle ?? "someone"}: ${r.note}`);
    }
    out.items.push({
      kind: "interaction", id: i.id, href: "/engage",
      label: `${needsPerson ? "Needs you — " : ""}${INTERACTION_KIND_LABELS[i.kind]}: ${truncate(i.body, 60)}`,
    });
  }

  await db.insert(activity).values({
    brandId: brand.id, actorId: null, action: "agent.replies_drafted", entity: "interaction", entityId: null,
    meta: { agent: "community", drafted, flagged, silent, ...usage },
  });

  out.summary = [
    `Drafted ${drafted} repl${drafted === 1 ? "y" : "ies"} for review.`,
    flagged ? `${flagged} need${flagged === 1 ? "s" : ""} a person's decision.` : "",
    silent ? `${silent} left without a reply (spam or nothing to say).` : "",
  ].filter(Boolean).join(" ");
  return out;
}
