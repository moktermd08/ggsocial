import "server-only";
import { eq } from "drizzle-orm";
import { db, activity, channels, interactions } from "@/lib/db";
import { INTERACTION_KIND_LABELS } from "@/lib/db/engagement";
import { getPlatform, platformOrNull } from "@/lib/platforms";
import { freshCredentials, isRevokedToken, markReconnect, ReconnectError } from "@/server/channel-auth";
import { communityGuidelines, draftReplies, loadRows, saveDraftedReply } from "@/server/agents/community";
import type { StepContext, StepResult, WorkflowImpl, WorkflowRun } from "@/server/workflows/types";

/**
 * "Answer a comment or message": the community manager's work, as a workflow.
 *
 *   reply → the agent's draft (batch-drafted by the community manager, or
 *           redrafted here when a person sends it back)
 *   send  → posted through the platform's API where it has one; elsewhere a
 *           person pastes it and marks it replied in Engagement
 *
 * With review on for "reply" (the default), every reply waits in the Review
 * inbox, as the community manager's drafts always did. With it off, a reply
 * the reviewer passes goes out by itself.
 */

const MINUTE = 60_000;
const CLOSED = ["replied", "done", "ignored"];

async function load(run: WorkflowRun) {
  if (run.subjectType !== "interaction" || !run.subjectId) return null;
  return (await db.query.interactions.findFirst({ where: eq(interactions.id, run.subjectId) })) ?? null;
}

async function reply(ctx: StepContext): Promise<StepResult> {
  const { run, brand } = ctx;
  const item = await load(run);
  if (!item) return { outcome: "cancel", summary: "The item was deleted." };
  if (CLOSED.includes(item.status)) return { outcome: "cancel", summary: "Someone already dealt with it." };

  let body = item.replyBody ?? "";
  let reasons = Array.isArray(run.context.reasons) ? (run.context.reasons as string[]) : [];
  let usage = null;
  // A person sent it back, or there is no draft yet: draft this one reply now.
  if (ctx.feedback || !body) {
    const rows = await loadRows(brand.id, [item.id]);
    const { drafted, usage: u } = await draftReplies(brand, rows, {
      guidelines: await communityGuidelines(brand.id), feedback: ctx.feedback, source: "workflow:answer-engagement",
    });
    const d = drafted[0];
    if (!d) throw new Error("No draft came back for this item.");
    await saveDraftedReply(item, d);
    body = d.reply;
    reasons = d.reasons;
    usage = u;
    if (!body) return { outcome: "cancel", summary: "The agent judged it needs no reply, and closed it." };
  }

  const channel = item.channelId ? await db.query.channels.findFirst({ where: eq(channels.id, item.channelId) }) : null;
  const where = channel ? ` on ${platformOrNull(channel.platform)?.name ?? channel.platform}` : "";
  const kind = INTERACTION_KIND_LABELS[item.kind].toLowerCase();
  return {
    outcome: "done",
    summary: `Drafted a reply to ${item.authorName ?? item.authorHandle ?? "someone"}'s ${kind}${where}.`,
    output: { reply: body },
    usage,
    reasons,
    href: "/engage",
    review: {
      kind: `reply to a ${kind}${where}`,
      text: `They said:\n${item.body}\n\nThe brand's reply:\n${body}`,
      screen: [body],
    },
  };
}

async function send(ctx: StepContext): Promise<StepResult> {
  const item = await load(ctx.run);
  if (!item) return { outcome: "cancel", summary: "The item was deleted." };
  if (item.status === "replied") return { outcome: "done", summary: "Replied.", byHuman: true };
  if (CLOSED.includes(item.status)) return { outcome: "cancel", summary: "Someone closed it without replying." };
  if (!item.replyBody?.trim()) return { outcome: "cancel", summary: "There is no reply to send." };

  const channel = item.channelId ? await db.query.channels.findFirst({ where: eq(channels.id, item.channelId) }) : null;
  const platform = channel ? getPlatform(channel.platform) : null;
  const byHand = (why: string): StepResult => ({
    outcome: "human",
    summary: why,
    question: `Post the reply${channel ? ` on ${platform?.name ?? channel.platform}` : ""}, then mark it replied in Engagement.`,
    href: "/engage",
    recheckAt: new Date(ctx.now.getTime() + 30 * MINUTE),
  });

  if (!channel || !platform) return byHand("This item has no channel to reply through.");
  if (channel.mode !== "live" || !platform.sendReply || !item.externalId) {
    return byHand(`${platform.name} ${channel.mode !== "live" ? "is not connected" : "has no API for replies"}, so a person posts it.`);
  }

  try {
    const credentials = await freshCredentials(channel);
    const res = await platform.sendReply({ channel, credentials, replyTo: item.externalId, body: item.replyBody });
    const now = new Date();
    await db.update(interactions).set({ status: "replied", repliedAt: now, updatedAt: now, replyUrl: res.externalUrl ?? item.externalUrl })
      .where(eq(interactions.id, item.id));
    await db.insert(activity).values({
      brandId: item.brandId, actorId: null, action: "interaction.replied", entity: "interaction", entityId: item.id,
      meta: {
        kind: item.kind, via: "api", workflowRun: ctx.run.id,
        minutes: Math.max(0, Math.round((now.getTime() - item.receivedAt.getTime()) / MINUTE)),
      },
    });
    return { outcome: "done", summary: `Replied on ${platform.name}.` };
  } catch (err) {
    if (err instanceof ReconnectError) return byHand(`${platform.name} needs connecting again, so a person posts this one.`);
    if (isRevokedToken(err)) {
      await markReconnect(channel, `${platform.name} no longer accepts the sign-in. Connect it again.`);
      return byHand(`${platform.name} needs connecting again, so a person posts this one.`);
    }
    throw err;
  }
}

export const answerEngagement: WorkflowImpl = {
  handlers: { reply, send },

  async onSendBack(run, _userId, note) {
    if (run.subjectType !== "interaction" || !run.subjectId) return;
    const item = await db.query.interactions.findFirst({ where: eq(interactions.id, run.subjectId) });
    await db.update(interactions).set({
      status: "in_progress", updatedAt: new Date(),
      notes: [item?.notes, `Sent back to the agent: ${note}`].filter(Boolean).join("\n"),
    }).where(eq(interactions.id, run.subjectId));
  },

  async onReject(run, _userId, note) {
    if (run.subjectType !== "interaction" || !run.subjectId) return;
    // The draft is not sent; the item stays in Engagement for a person to handle their own way.
    const item = await db.query.interactions.findFirst({ where: eq(interactions.id, run.subjectId) });
    await db.update(interactions).set({
      status: "in_progress", agentCode: null, updatedAt: new Date(),
      notes: [item?.notes, `The agent's reply was stopped${note ? `: ${note}` : "."}`].filter(Boolean).join("\n"),
    }).where(eq(interactions.id, run.subjectId));
  },
};
