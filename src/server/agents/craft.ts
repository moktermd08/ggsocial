import { AI_TELL_PHRASES } from "@/lib/playbook/writing-tells";

/**
 * House craft, shared by every agent that writes or judges words: how copy
 * should sound, how a hook is built, how ideas are spread across angles.
 * Constants, never built per call, so the system prompts that embed them
 * stay byte-identical and keep caching. The playbook's rules still win: this
 * is the standing craft, not a limit.
 */

export const PLAIN_WRITING = `Write like a person, not like a model:
- Never use stock AI phrases (${AI_TELL_PHRASES.filter((p) => !p.includes("’")).slice(0, 12).join(", ")} and the like).
- Never use the "it's not just X, it's Y" turn, and no more than two em dashes in a piece. Use a full stop or a comma.
- No throat-clearing openers ("In today's world…", "Let's talk about…") and no closing summary that repeats the post.
- Do not stack three adjectives or three parallel clauses by reflex. One concrete detail beats a list of qualities.
- Hedge only where the brand is actually unsure; never "might potentially" or "can help to".
- Vary sentence length. Short sentences are fine. Say the plain word, not the grand one.`;

export const HOOK_CRAFT = `Building the first line (on most platforms it is all anyone reads):
- Know how aware the reader is. Someone who feels the problem needs it named in their words; someone who does not needs a surprising fact or a small story that shows it.
- Pick one angle and commit: a number, a mistake, a before/after, a contrarian view, a named situation, a question only this audience asks. Do not blend three.
- On video, the hook must land in the first three seconds, on screen and in words, before any branding or intro.
- Answer the reader's likely objection ("is this for me?", "does it really work?", "is it worth the time?") with something specific, not reassurance.
- Do not promise what the rest of the piece does not deliver.`;

export const ANGLE_SPREAD = `Spreading ideas across angles:
- For the same pillar, vary the angle: a mistake people make, a behind-the-scenes, a before/after, a myth to correct, a how-to, a customer situation, a quick opinion. Do not propose two ideas in a batch with the same angle.
- Say who the idea is for and how much they already know, so the writer can aim the first line.
- Prefer ideas the audience would send to a colleague or save for later over ideas that only announce.`;
