import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, activity, brandAgents, channels, interactions, posts } from "@/lib/db";
import { INTERACTION_KIND_LABELS } from "@/lib/db/engagement";
import { platformOrNull } from "@/lib/platforms";
import { truncate } from "@/lib/format";
import type { AgentUsage } from "@/lib/agents/meta";
import { getBrandPlaybook } from "@/server/playbook";
import { askClaude, addUsage } from "@/server/agents/claude";
import { advance, startRun } from "@/server/workflows";
import type { AgentJob, AgentOutcome } from "@/server/agents/types";

/**
 * The community manager: drafts a reply to each new inbound comment, message,
 * mention and review, and sorts it by tone and urgency. Drafting is batched —
 * one call for up to a run's worth of items is far cheaper than one each —
 * then every reply goes through the "answer a comment or message" workflow,
 * where the reviewer reads it and it stops for a person, or is sent, as the
 * brand's settings say.
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

type Brand = AgentJob["brand"];
type Row = { i: typeof interactions.$inferSelect; platform: string | null; postTitle: string | null };

export type DraftedReply = {
  id: string;
  reply: string;
  sentiment: "positive" | "neutral" | "negative" | "question";
  priority: "low" | "normal" | "high";
  /** Why a person must decide this one, whatever the review settings. Empty = nothing. */
  reasons: string[];
  note: string;
};

/**
 * Drafts replies for these items in one call, and checks each in code for
 * what a model can slip on: banned words, emoji, the platform's length.
 * `feedback` is a person's note when this is a redo of one reply.
 */
export async function draftReplies(brand: Brand, rows: Row[], opts: { guidelines?: string | null; feedback?: string | null; source: string }) {
  // The playbook's rules for this kind of work, as this brand has tuned them.
  const playbook = await getBrandPlaybook(brand.id);
  const rules = playbook.filter((r) => r.enabled && ["reply", "dm", "review-reply", "leads"].includes(r.code));

  const task = [
    rules.length ? "House rules for this work:" : "",
    ...rules.map((r) => `- ${r.name}: ${r.instructions}${r.brandNotes ? ` For this brand: ${r.brandNotes}` : ""}`),
    opts.guidelines?.trim() ? `\nStanding guidelines from the brand's team (follow these):\n${opts.guidelines.trim()}` : "",
    `\nThe brand aims to answer within ${brand.replySlaMinutes} minutes.`,
    opts.feedback ? `\nA person reviewed the earlier draft of this reply and asked for this change — make it:\n${opts.feedback}` : "",
    "\nItems (return one reply per id, same ids):",
    ...rows.map(({ i, platform, postTitle }) => [
      `- id: ${i.id}`,
      `  kind: ${INTERACTION_KIND_LABELS[i.kind]}${platform ? ` on ${platformOrNull(platform)?.name ?? platform}` : ""}`,
      i.authorName || i.authorHandle ? `  from: ${[i.authorName, i.authorHandle].filter(Boolean).join(" ")}${i.authorReach ? ` (${i.authorReach} followers)` : ""}` : "",
      postTitle ? `  on our post: ${postTitle}` : "",
      `  said: ${i.body.replace(/\s+/g, " ").trim()}`,
    ].filter(Boolean).join("\n")),
  ].filter((l) => l !== "").join("\n");

  const { output, usage } = await askClaude({ schema: ReplySchema, system: SYSTEM, brand, task, source: opts.source });

  const banned = brand.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const drafted: DraftedReply[] = [];
  for (const { i, platform } of rows) {
    const r = output.replies.find((x) => x.id === i.id);
    if (!r) continue;
    // Checked in code, as drafting does: a draft that breaks a house rule is stopped, not hidden.
    const problems: string[] = [];
    const lower = r.reply.toLowerCase();
    for (const w of banned) if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) problems.push(`The reply uses the banned word "${w}".`);
    if (brand.emojiPolicy === "none" && EMOJI.test(r.reply)) problems.push("The reply uses emoji; this brand uses none.");
    const max = platform ? platformOrNull(platform)?.constraints.textMax : undefined;
    if (max && r.reply.length > max) problems.push(`The reply is ${r.reply.length} characters, over the ${max} limit.`);
    const reasons = [...(r.handToPerson ? [`The agent says a person must decide this one: ${r.note}`] : []), ...problems];
    drafted.push({ id: i.id, reply: r.reply.trim(), sentiment: r.sentiment, priority: reasons.length ? "high" : r.priority, reasons, note: r.note });
  }
  return { drafted, usage };
}

/** Writes a drafted reply onto its item, where Engagement shows it. */
export async function saveDraftedReply(row: typeof interactions.$inferSelect, d: DraftedReply) {
  const note = `Community agent: ${d.note}${d.reasons.length ? " A person must decide this one before anything is sent." : ""}`;
  await db.update(interactions).set({
    replyBody: d.reply || null,
    agentCode: d.reply ? "community" : null,
    sentiment: d.sentiment,
    priority: d.priority,
    // Nothing worth saying (spam, a bot): the agent closes it rather than leave it in the queue.
    status: d.reply ? "in_progress" : "ignored",
    notes: [row.notes, note].filter(Boolean).join("\n"),
    updatedAt: new Date(),
  }).where(eq(interactions.id, row.id));
}

export async function loadRows(brandId: string, ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  return db.select({ i: interactions, platform: channels.platform, postTitle: posts.title })
    .from(interactions)
    .leftJoin(channels, eq(channels.id, interactions.channelId))
    .leftJoin(posts, eq(posts.id, interactions.postId))
    .where(and(eq(interactions.brandId, brandId), inArray(interactions.id, ids)));
}

export async function communityGuidelines(brandId: string) {
  const row = await db.query.brandAgents.findFirst({
    where: and(eq(brandAgents.brandId, brandId), eq(brandAgents.agentCode, "community")),
    columns: { guidelines: true },
  });
  return row?.guidelines ?? null;
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

  const { drafted, usage } = await draftReplies(brand, rows, { guidelines: config.guidelines, source: "agent:community" });
  out.usage = usage;

  let sent = 0, waiting = 0, flagged = 0, silent = 0;
  for (const { i } of rows) {
    const d = drafted.find((x) => x.id === i.id);
    if (!d) { out.issues.push(`No draft came back for ${truncate(i.body, 40)}.`); continue; }
    await saveDraftedReply(i, d);
    if (!d.reply) {
      silent++;
      out.items.push({ kind: "interaction", id: i.id, href: "/engage", label: `Closed without a reply: ${truncate(i.body, 60)}` });
      continue;
    }

    // The draft is written; the workflow takes it from here — reviewer, review settings, sending.
    const run = await startRun({
      brandId: brand.id, code: "answer-engagement", startedBy: "community",
      subject: { type: "interaction", id: i.id }, context: { reasons: d.reasons },
    });
    const report = await advance(run.id, { agentSteps: true, now: job.now });
    for (const step of report?.steps ?? []) if (step.usage) out.usage = addUsage(out.usage, step.usage as AgentUsage);
    const status = report?.run.status;
    if (status === "done") sent++;
    else if (d.reasons.length || status === "waiting_review") { waiting++; if (d.reasons.length) flagged++; }
    else waiting++;
    if (d.reasons.length) out.issues.push(`${INTERACTION_KIND_LABELS[i.kind]} from ${i.authorName ?? i.authorHandle ?? "someone"}: ${d.note}`);
    out.items.push({
      kind: "interaction", id: i.id, href: "/review",
      label: `${status === "done" ? "Sent" : d.reasons.length ? "Needs you" : "For review"} — ${INTERACTION_KIND_LABELS[i.kind]}: ${truncate(i.body, 60)}`,
    });
  }

  await db.insert(activity).values({
    brandId: brand.id, actorId: null, action: "agent.replies_drafted", entity: "interaction", entityId: null,
    meta: { agent: "community", drafted: rows.length - silent, sent, waiting, flagged, silent, ...usage },
  });

  out.summary = [
    `Drafted ${rows.length - silent} repl${rows.length - silent === 1 ? "y" : "ies"}.`,
    sent ? `${sent} sent without review.` : "",
    waiting ? `${waiting} waiting in the Review inbox${flagged ? `, ${flagged} flagged for a person's decision` : ""}.` : "",
    silent ? `${silent} closed without a reply (spam or nothing to say).` : "",
  ].filter(Boolean).join(" ");
  return out;
}
