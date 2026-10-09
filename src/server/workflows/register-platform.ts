import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, activity, channels } from "@/lib/db";
import { hasPublicPage, platformOrNull } from "@/lib/platforms";
import { offHandle, registrationBlockers, registrationPack } from "@/lib/registration";
import { checkChannelPages } from "@/server/page-checks";
import type { StepContext, StepResult, WorkflowImpl } from "@/server/workflows/types";

/**
 * "Register the brand on a platform", following the playbook's registration
 * rule. One run per platform the brand is missing from.
 *
 *   check    → already registered? Then nothing to do and the run ends.
 *              Otherwise the brand page must pass its details check first.
 *   prepare  → the exact values for the sign-up form, from the brand page
 *   register → a person creates (or claims) the account and adds the channel
 *              with its page URL; platforms do not allow an agent to do this
 *   verify   → the page opens and belongs to the brand, the handle matches
 */

const HOUR = 3_600_000;

async function liveChannels(brandId: string) {
  return db.select().from(channels).where(and(eq(channels.brandId, brandId), isNull(channels.archivedAt)));
}

function platformOf(ctx: StepContext) {
  const id = typeof ctx.run.context.platform === "string" ? ctx.run.context.platform : "";
  return platformOrNull(id);
}

async function check(ctx: StepContext): Promise<StepResult> {
  const platform = platformOf(ctx);
  if (!platform) return { outcome: "cancel", summary: "That platform is no longer supported." };
  const all = await liveChannels(ctx.brand.id);
  const have = all.find((c) => c.platform === platform.id);
  if (have) return { outcome: "cancel", summary: `Already registered on ${platform.name} as ${have.handle}. Nothing to do.` };

  const blockers = registrationBlockers(ctx.brand, all);
  if (blockers.length) {
    return {
      outcome: "stop",
      summary: `The brand page is not ready to register ${platform.name}.`,
      reasons: blockers.map((i) => `${i.field}: ${i.message}`),
      question: "Fix these on the brand page, then retry. Registration copies the brand page word for word.",
      href: `/brands/${ctx.brand.id}`, sendBackTo: null,
    };
  }
  return { outcome: "done", summary: `Not on ${platform.name} yet; the brand page is ready.` };
}

async function prepare(ctx: StepContext): Promise<StepResult> {
  const platform = platformOf(ctx);
  if (!platform) return { outcome: "cancel", summary: "That platform is no longer supported." };
  const pack = registrationPack(ctx.brand, await liveChannels(ctx.brand.id));
  const steps = [
    `Search ${platform.name} for "${ctx.brand.name}", ${ctx.brand.website ?? "the website"}${ctx.brand.phone ? ` and ${ctx.brand.phone}` : ""}. If a profile already exists, claim it instead of making a second one.`,
    "Sign up with a shared address on the brand's own domain, never a personal email. Turn on two-step verification, save the login in the team password manager and add a second admin.",
    `Handle: ${pack.handle ?? "none agreed yet, pick one and use it on every channel"}. If it is taken, use the agreed fallback.`,
    "Paste the values below. Do not retype them. Trim the bio to the platform's limit without changing facts or adding claims.",
    "Profile picture is the icon mark; the cover is the current cover at the platform's size.",
    "Add the channel under Channels the same day with its page URL, then verify ownership and apply for verification where offered.",
  ];
  return {
    outcome: "done",
    summary: `Registration pack for ${platform.name} ready.`,
    output: { platform: platform.id, handle: pack.handle, fields: pack.fields, logoIcon: pack.logoIcon, steps },
    context: { pack: { handle: pack.handle, fields: pack.fields } },
    question: `Register ${ctx.brand.name} on ${platform.name} with these details? Reject to never register here.`,
    href: "/channels",
  };
}

async function register(ctx: StepContext): Promise<StepResult> {
  const platform = platformOf(ctx);
  if (!platform) return { outcome: "cancel", summary: "That platform is no longer supported." };
  const have = (await liveChannels(ctx.brand.id)).find((c) => c.platform === platform.id);
  if (have) return { outcome: "done", summary: `Registered on ${platform.name} as ${have.handle}.`, byHuman: true, context: { channelId: have.id } };
  return {
    outcome: "human",
    summary: `Waiting for someone to register on ${platform.name}.`,
    question: `Create or claim the ${platform.name} account from the registration pack, then add it under Channels with its page URL.`,
    href: "/channels",
    recheckAt: new Date(ctx.now.getTime() + 6 * HOUR),
  };
}

async function verify(ctx: StepContext): Promise<StepResult> {
  const platform = platformOf(ctx);
  if (!platform) return { outcome: "cancel", summary: "That platform is no longer supported." };
  const all = await liveChannels(ctx.brand.id);
  const ch = all.find((c) => c.platform === platform.id);
  if (!ch) return { outcome: "stop", summary: "The channel is gone.", reasons: [`No ${platform.name} channel on the brand any more.`], question: "Add the channel again, then retry.", href: "/channels", sendBackTo: "register" };

  const notes: string[] = [];
  if (offHandle(ch.handle, all.filter((c) => c.id !== ch.id))) {
    notes.push(`Handle ${ch.handle} differs from the one most channels use. Note why if the platform forced it.`);
  }
  if (hasPublicPage(platform.id)) {
    if (!ch.pageUrl) {
      return { outcome: "stop", summary: "The channel has no page URL.", reasons: ["Audits can only see the page once its URL is saved on the channel."], question: "Add the page URL to the channel, then retry.", href: "/channels", sendBackTo: null };
    }
    const [result] = await checkChannelPages([ch.id]);
    if (result?.status === "down") {
      return { outcome: "stop", summary: `The ${platform.name} page does not load.`, reasons: [result.note], question: "Check the page URL and that the account is not suspended, then retry.", href: "/channels", sendBackTo: null };
    }
    if (result?.status === "unknown") notes.push(`Could not confirm the page automatically (${result.note}). Open it once by hand.`);
  }
  await db.insert(activity).values({
    brandId: ctx.brand.id, actorId: null, action: "channel.registration_verified", entity: "channel", entityId: ch.id,
    meta: { platform: platform.id, workflowRun: ctx.run.id },
  });
  return { outcome: "done", summary: [`Verified on ${platform.name} as ${ch.handle}.`, ...notes].join(" "), subject: { type: "channel", id: ch.id } };
}

export const registerPlatform: WorkflowImpl = { handlers: { check, prepare, register, verify } };
