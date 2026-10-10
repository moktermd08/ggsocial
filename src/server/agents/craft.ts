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
- Vary sentence length. Short sentences are fine. Say the plain word, not the grand one.
- No one-sentence-per-line "broetry" for a whole post. Write paragraphs and break where a person would pause.
- No engagement bait ("Agree?", "Thoughts?", "Let that sink in"). End on the point, or on a question the brand genuinely wants answered.
- No self-answered reveals ("The result? Three times faster.") and no "No X, no Y, no Z" lists. Say what does happen.
- No emoji as bullets, and no vulnerability the brand does not actually have a story for.`;

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

export const PLATFORM_CRAFT = `Shaping the same idea for each platform:
- The story comes first on every platform. Format and timing only help a good story travel; they never replace one.
- LinkedIn: paragraphs, a real point of view, a short story is welcome. Keep an outside link out of the body when the channel allows a first comment.
- X: one sharp thought per post. A thread only when the idea has steps, and each post in it must stand on its own.
- Instagram and Facebook: the caption supports the picture or clip; do not repeat what the viewer can already see. A carousel carries one idea, one step per slide, with the payoff on the last slide.
- Short video: the hook lands in three seconds on screen and in words, it makes sense with the sound off, and it ends the moment the point is made.
- Pick the carousel shape that fits the idea: a stack of value, a problem then proof, a list of tips, a call-out of a common mistake, or a walkthrough of how it is done.
- A piece must work on its own: never assume the reader saw the post, video or episode it came from.`;

export const STRATEGY_CRAFT = `Choosing what to make:
- Every idea is meant to be found, shared, or both. Found: it answers a question people already ask, in the words they use. Shared: it gives people something worth passing on, such as a real number, a named situation, a view they will argue with, or a story that costs the brand something to tell.
- Before proposing a found-type idea, say in "why" what this brand adds that a search for it would not already give: a real example, a result the brand has, a clearer answer, a firmer opinion. If nothing, drop the idea.
- Keep a spread across the brand's pillars and across found, shared and behind-the-scenes ideas, and keep promotional ideas a small minority.
- One strong piece can feed several: pull out the single moments that stand alone (a claim, a story, a tip, a number) and give each its own idea, rather than trimming the same text.
- Prefer ideas the brand can make repeatedly with what it really has over ideas that need an asset or a person it does not have.`;
