import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { BrandOffering, brands, contentIdeas } from "@/lib/db";
import { platformOrNull } from "@/lib/platforms";
import { checkContent, describeRule, resolveFormat, type EffectiveRule } from "@/lib/playbook/check";
import { recordUsage } from "@/server/ai-usage";

/**
 * Claude drafting: one idea, told in one brand's voice, written separately
 * for each platform it is going out on.
 *
 * Drafts are always a starting point for a person. Nothing here publishes, and
 * the composer applies a draft for review rather than saving over anyone's work.
 */

/**
 * Which model does which job. Social copy and replies are short and the brand
 * book does most of the steering, so Sonnet writes them at well under half of
 * Opus's price per token. The reviewer reads one short piece of work and
 * scores it, which the cheapest model does well. Set CLAUDE_WRITING_MODEL,
 * CLAUDE_ANALYSIS_MODEL or CLAUDE_REVIEW_MODEL (to claude-opus-5, say) to
 * move a job to a bigger model.
 */
export const MODELS = {
  writing: process.env.CLAUDE_WRITING_MODEL || "claude-sonnet-5",
  analysis: process.env.CLAUDE_ANALYSIS_MODEL || "claude-sonnet-5",
  review: process.env.CLAUDE_REVIEW_MODEL || "claude-haiku-4-5",
};
export type ModelJob = keyof typeof MODELS;

/**
 * Opus and Fable can hand a declined request to a fallback model inside the
 * same call; other models return the refusal, which callers already handle.
 */
export function fallbackFor(model: string) {
  return /opus|fable/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
}

/**
 * Medium effort: social copy is short and the brand book does most of the
 * steering, so the deepest thinking level buys little. It also has to finish
 * inside the 120s Apache proxy timeout on the live box, repair round included.
 */
const EFFORT = "medium" as const;

const DraftSchema = z.object({
  title: z.string().describe("A short internal working title for the post."),
  body: z.string().describe("The base post for this brand, before any platform-specific tuning."),
  channels: z.array(z.object({
    channelId: z.string(),
    body: z.string(),
    firstComment: z.string().nullable().describe("Only where the platform supports a first comment; otherwise null."),
  })),
  hashtags: z.array(z.string()),
  note: z.string().describe("One line for the person reviewing: the angle taken, and anything to check."),
});

export type Draft = z.infer<typeof DraftSchema>;

export type DraftChannel = {
  id: string;
  platform: string;
  handle: string;
  /** The tracked short link for this channel, when one has been issued. */
  link?: string | null;
  /** The channel's platform options — an Instagram reel or story, say — which pick its playbook rule. */
  options?: Record<string, unknown>;
};

export type DraftBrief = {
  brand: typeof brands.$inferSelect;
  idea?: typeof contentIdeas.$inferSelect | null;
  /** What the writer has so far — the brief when there is no idea behind the post. */
  title?: string;
  body?: string;
  channels: DraftChannel[];
  /** The brand's playbook, and the format picked for the post, so each channel's copy follows its rule. */
  playbook?: EffectiveRule[];
  postType?: string | null;
  media?: { kind: string }[];
  /** Standing instructions a person gave the brand's writer agent. */
  guidelines?: string | null;
  /** What a reviewer asked to change, when this is a revision of a sent-back post. */
  feedback?: string | null;
  /** Who asked, for the spend ledger: "workflow:publish-post", say. A person in the composer when unset. */
  source?: string;
};

/** The limits a writer controls. Media and timing are the person's to sort. */
const COPY_KEYS = new Set(["titleRequired", "titleMaxWords", "hashtagsMin", "hashtagsMax", "bodyMinChars", "bodyMaxChars"]);

/** The playbook rule each channel falls under, by channel id. */
function rulesFor(brief: DraftBrief) {
  const out = new Map<string, EffectiveRule>();
  if (!brief.playbook?.length) return out;
  for (const c of brief.channels) {
    const rule = resolveFormat(brief.playbook, { platform: c.platform, options: c.options, postType: brief.postType, media: brief.media });
    if (rule) out.set(c.id, rule);
  }
  return out;
}

export type DraftResult = {
  draft: Draft;
  /** Problems the draft still has after the repair round. Shown, never hidden. */
  issues: string[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; model: string };
};

export class DraftingError extends Error {}

/* ------------------------------------------------------------------ prompt */

// Stable across every brand and idea, so it sits first and caches.
const SYSTEM = `You write social posts for a small group of related brands run by one person. Each post starts from an idea in their content plan — a problem, what gets done about it, and the outcome — and your job is to tell that idea in one brand's voice, for the specific platforms it will go out on.

What good looks like here:
- It sounds like the brand, not like marketing. Match the voice, audience and rules in the brand book. Where the brand book is thin, write plainly and specifically rather than inventing a personality.
- It leads with the problem as the reader lives it. The first line is the hook; on most platforms it is all anyone reads before deciding.
- Concrete beats clever. One real detail is worth three adjectives, and nothing is claimed that the brand could not back up.
- Each platform gets copy written for it, not the same text cut down: LinkedIn can carry a short story, X needs one sharp thought, a newsletter can explain. Character limits are hard limits — going over blocks publishing.
- Hashtags only where the platform uses them, a few at most, at the end.
- When a tracked link is given for a channel, use that exact URL and no other: it is how traffic is measured. Where the platform supports a first comment, the link can go there instead of the body.
- Never use a banned word, and follow the emoji policy exactly.

The idea is written in shorthand and usually names one company as the one doing the work. Retell it from this brand's own position: a person speaks in the first person from experience; a company speaks as the one that does the work. Never make a different brand the hero of the story.`;

const offerings = (rows: BrandOffering[]) =>
  rows.map((o) => [o.name, o.description].filter(Boolean).join(" — ")).join("; ") || null;

export function brandBook(brand: typeof brands.$inferSelect) {
  // Fixed field order: this block is a cache key, and a reordering would
  // silently miss the cache on every call.
  const lines: [string, string | null | undefined][] = [
    ["Brand", brand.name],
    ["Positioning", brand.tagline],
    ["What it does", brand.description],
    ["Industry", brand.industry],
    ["Audience", brand.audience],
    ["Voice", brand.voice],
    ["Rules and notes", brand.brief],
    ["Value propositions", brand.valueProps.join("; ") || null],
    ["Banned words", brand.bannedWords.join(", ") || null],
    ["Emoji policy", { free: "emoji are fine", sparing: "at most one or two emoji", none: "never use emoji" }[brand.emojiPolicy]],
    ["Call to action", brand.ctaText],
    ["House hashtags", brand.defaultHashtags.join(" ") || null],
    ["Website", brand.website],
    ["Products", offerings(brand.products)],
    ["Services", offerings(brand.services)],
    ["Customer segments", brand.audienceSegments.map((s) => s.description ? `${s.name} (${s.description})` : s.name).join("; ") || null],
    ["Markets", brand.markets],
    ["Competitors (context only, never name them)", brand.competitors.join(", ") || null],
    ["Key people", brand.people.map((p) => p.role ? `${p.name}, ${p.role}` : p.name).join("; ") || null],
    ["Proof points (claims the brand can back up)", brand.proofPoints.join("; ") || null],
    ["Contact page", brand.contactUrl],
  ];
  const filled = lines.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v!.trim()}`);
  return `Brand book\n\n${filled.join("\n")}`;
}

/** The user turn for a brief. Exported so the prompt can be inspected without a call. */
export function draftRequestText(brief: DraftBrief) {
  const { idea, channels } = brief;
  const parts: string[] = [];

  if (idea) {
    parts.push(
      `Idea ${idea.sequence}${idea.pillar ? ` — ${idea.pillar}` : ""}`,
      `Problem: ${idea.problem}`,
      idea.action ? `What gets done: ${idea.action}` : "",
      idea.outcome ? `Outcome: ${idea.outcome}` : "",
      idea.postType ? `Post type: ${idea.postType}` : "",
      idea.tone ? `Tone: ${idea.tone}` : "",
      idea.notes ? `Planning notes: ${idea.notes}` : "",
    );
  }
  if (brief.title?.trim() || brief.body?.trim()) {
    parts.push(
      "",
      idea ? "What the writer has so far (keep what works):" : "What the writer wants to say:",
      brief.title?.trim() ? `Title: ${brief.title.trim()}` : "",
      brief.body?.trim() ? brief.body.trim() : "",
    );
  }
  if (brief.guidelines?.trim()) {
    parts.push("", "Standing guidelines from the brand's team (follow these):", brief.guidelines.trim());
  }
  if (brief.feedback?.trim()) {
    parts.push("", "The reviewer sent the last version back. Their note, which this revision must address:", brief.feedback.trim());
  }

  parts.push("", `Write the base post for ${brief.brand.name}, then one version per channel below.`);

  const rules = rulesFor(brief);
  if (channels.length === 0) {
    parts.push("No channels are picked yet: write the base post only and return an empty channels list.");
  } else {
    parts.push("", "Channels:");
    for (const c of channels) {
      const p = platformOrNull(c.platform);
      const k = p?.constraints;
      parts.push([
        `- channelId: ${c.id}`,
        `platform: ${p?.name ?? c.platform} (${c.handle})`,
        k ? `limit: ${k.textMax} characters` : "",
        k ? `hashtags: ${k.hashtagsUseful ? "useful" : "do not use"}` : "",
        k ? `first comment: ${k.supportsFirstComment ? "supported" : "not supported"}` : "",
        k && k.supportsLinks === false ? "links: not clickable here" : "",
        c.link ? `tracked link: ${c.link}` : "",
        rules.get(c.id) ? `playbook: ${rules.get(c.id)!.name}` : "",
      ].filter(Boolean).join(" | "));
    }
  }

  // The house rules for each format in play, once each: what the reviewer will hold the draft to.
  const inPlay = [...new Map([...rules.values()].map((r) => [r.code, r])).values()];
  if (inPlay.length) {
    parts.push("", "Playbook — the brand's house rules for these formats. Where they set a title length or a hashtag count, that wins over any general advice: hashtags go at the end of each channel's copy, and the title field is the post's public title.");
    for (const r of inPlay) {
      const limits = describeRule(r).filter((l) => /^(Title|Hashtags|Copy):/.test(l));
      const points = r.checklist.filter((i) => i.for !== "human").map((i) => i.text);
      parts.push([
        `- ${r.name}: ${r.instructions}`,
        r.brandNotes ? `  For this brand: ${r.brandNotes}` : "",
        limits.length ? `  Limits: ${limits.join("; ")}` : "",
        points.length ? `  Check before returning: ${points.join("; ")}` : "",
      ].filter(Boolean).join("\n"));
    }
  }

  return parts.filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n").trim();
}

/* ----------------------------------------------------------------- checking */

const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * The rules a draft can break that would block publishing or embarrass the
 * brand. Checked in code rather than trusted, because the model is asked to
 * follow them and a check is how you know it did.
 */
export function checkDraft(draft: Draft, brief: DraftBrief): string[] {
  const issues: string[] = [];
  const banned = brief.brand.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const texts = [
    { where: "base post", text: draft.body, max: null as number | null },
    ...draft.channels.map((v) => {
      const c = brief.channels.find((ch) => ch.id === v.channelId);
      const p = c ? platformOrNull(c.platform) : null;
      return { where: p?.name ?? "a channel", text: `${v.body}\n${v.firstComment ?? ""}`, max: p?.constraints.textMax ?? null, body: v.body };
    }),
  ];

  for (const t of texts) {
    const lower = t.text.toLowerCase();
    for (const word of banned) {
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) {
        issues.push(`${t.where}: uses the banned word "${word}".`);
      }
    }
    if (brief.brand.emojiPolicy === "none" && EMOJI.test(t.text)) issues.push(`${t.where}: uses emoji, and this brand never does.`);
    const body = "body" in t ? t.body : t.text;
    if (t.max !== null && body.length > t.max) issues.push(`${t.where}: ${body.length} characters, over the ${t.max} limit.`);
  }

  // Every tracked link that was handed over has to come back, byte for byte.
  for (const c of brief.channels) {
    if (!c.link) continue;
    const v = draft.channels.find((d) => d.channelId === c.id);
    const text = `${v?.body ?? ""}\n${v?.firstComment ?? ""}`;
    if (v && !text.includes(c.link)) issues.push(`${platformOrNull(c.platform)?.name ?? c.platform}: the tracked link is missing.`);
  }

  // The playbook's copy limits, per channel, exactly as the composer and approval will check them.
  const rules = rulesFor(brief);
  for (const v of draft.channels) {
    const rule = rules.get(v.channelId);
    if (!rule) continue;
    const c = brief.channels.find((ch) => ch.id === v.channelId);
    const name = platformOrNull(c?.platform ?? "")?.name ?? "a channel";
    const found = checkContent(rule, { title: draft.title, body: v.body, firstComment: v.firstComment, media: [], timezone: "UTC" })
      .filter((i) => COPY_KEYS.has(i.key));
    for (const i of found) issues.push(`${name}: ${i.message}`);
  }

  const expected = new Set(brief.channels.map((c) => c.id));
  const returned = new Set(draft.channels.map((c) => c.channelId));
  for (const id of expected) if (!returned.has(id)) issues.push("A channel came back without a version.");
  for (const id of returned) if (!expected.has(id)) issues.push("The draft included a channel it was not asked for.");

  return [...new Set(issues)];
}

/* ------------------------------------------------------------------- calling */

export const NOT_CONFIGURED = "Claude drafting is not set up: add ANTHROPIC_API_KEY to the server's .env and restart.";

export function draftingConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function client() {
  if (!draftingConfigured()) throw new DraftingError(NOT_CONFIGURED);
  // One retry, and a timeout that leaves room for a repair round inside the
  // proxy's 120s window. The SDK's default ten minutes would outlive Apache.
  return new Anthropic({ timeout: 55_000, maxRetries: 1 });
}

export function explain(err: unknown): never {
  if (err instanceof DraftingError) throw err;
  if (err instanceof Anthropic.AuthenticationError) throw new DraftingError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.PermissionDeniedError) throw new DraftingError("This Anthropic key is not allowed to use the model.");
  if (err instanceof Anthropic.RateLimitError) throw new DraftingError("Claude is rate-limited right now. Try again in a minute.");
  if (err instanceof Anthropic.BadRequestError) throw new DraftingError(`Claude rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionTimeoutError) throw new DraftingError("Claude took too long to answer. Try again.");
  if (err instanceof Anthropic.APIConnectionError) throw new DraftingError("Could not reach Claude. Check the server's network.");
  if (err instanceof Anthropic.APIError) throw new DraftingError(`Claude returned an error (${err.status}). Try again.`);
  throw err;
}

type Params = Parameters<Anthropic["beta"]["messages"]["parse"]>[0];

async function call(api: Anthropic, messages: Anthropic.Beta.BetaMessageParam[], brand: typeof brands.$inferSelect) {
  const params = {
    model: MODELS.writing,
    max_tokens: 16_000,
    // If a safety classifier declines, Opus retries on a fallback model
    // inside the same call rather than handing back nothing.
    ...fallbackFor(MODELS.writing),
    output_config: { effort: EFFORT, format: betaZodOutputFormat(DraftSchema) },
    system: [
      { type: "text", text: SYSTEM },
      // The brand book is the same for every idea this brand drafts, so the
      // prefix up to here is cached per brand.
      { type: "text", text: brandBook(brand), cache_control: { type: "ephemeral" } },
    ],
    messages,
  } satisfies Params;

  const res = await api.beta.messages.parse(params);

  if (res.stop_reason === "refusal") {
    throw new DraftingError("Claude declined to draft this one. Try rewording the idea.");
  }
  if (res.stop_reason === "max_tokens") {
    throw new DraftingError("The draft ran out of room before it finished. Try again with fewer channels.");
  }
  if (!res.parsed_output) {
    throw new DraftingError("Claude's answer could not be read as a draft. Try again.");
  }
  return res;
}

export async function draftPost(brief: DraftBrief): Promise<DraftResult> {
  const api = client();
  const started = Date.now();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: MODELS.writing };
  const add = (u: Anthropic.Beta.BetaUsage, model: string) => {
    usage.input += u.input_tokens;
    usage.output += u.output_tokens;
    usage.cacheRead += u.cache_read_input_tokens ?? 0;
    usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    usage.model = model;
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: draftRequestText(brief) }];

  try {
    let res = await call(api, messages, brief.brand);
    add(res.usage, res.model);
    let draft = res.parsed_output!;
    let issues = checkDraft(draft, brief);

    // One repair round for the problems that would block publishing, if there
    // is still time inside the proxy window. The assistant turn goes back
    // exactly as returned so its thinking blocks stay valid.
    if (issues.length > 0 && Date.now() - started < 50_000) {
      messages.push(
        { role: "assistant", content: res.content },
        {
          role: "user",
          content: `Revise the draft to fix these, keeping everything else:\n${issues.map((i) => `- ${i}`).join("\n")}`,
        },
      );
      res = await call(api, messages, brief.brand);
      add(res.usage, res.model);
      draft = res.parsed_output!;
      issues = checkDraft(draft, brief);
    }

    // Channel ids come from us; drop anything the model invented.
    const known = new Set(brief.channels.map((c) => c.id));
    draft = { ...draft, channels: draft.channels.filter((c) => known.has(c.channelId)) };

    console.info(
      `[drafting] ${brief.brand.name}: ${usage.input} in / ${usage.output} out / ${usage.cacheRead} cached (${usage.model}, ${Date.now() - started}ms)`,
    );
    await recordUsage(brief.brand.id, brief.source ?? "composer", usage);
    return { draft, issues, usage };
  } catch (err) {
    // Paid for whether or not the draft came back usable.
    if (usage.input + usage.output > 0) await recordUsage(brief.brand.id, brief.source ?? "composer", usage);
    explain(err);
  }
}
