/**
 * The marks that make copy read as machine-written: stock phrases, the
 * "not just X, it's Y" turn, a pile of em dashes. Client-safe, so the composer
 * flags them as you type and drafting, the reviewer and the agent API all
 * judge by the same list. Deliberately short and literal — a tell here is
 * something a careful editor would cut on sight, never a style opinion.
 */

/** Whole words or phrases, any case. Extend this list rather than the checker. */
export const AI_TELL_PHRASES = [
  "delve", "delving", "tapestry", "testament to", "game-changer", "game changer", "game-changing",
  "in today's fast-paced", "in today’s fast-paced", "in the ever-evolving", "ever-evolving landscape",
  "navigate the complexities", "it's important to note", "it’s important to note", "it's worth noting", "it’s worth noting",
  "let's dive in", "let’s dive in", "dive into", "unlock the power", "unlock your", "harness the power", "unleash",
  "supercharge", "elevate your", "revolutionize", "cutting-edge", "seamless", "seamlessly", "in conclusion",
  "here's the thing", "here’s the thing", "buckle up", "look no further", "take it to the next level",
];

const NOT_JUST = /\b(?:isn['’]t|is not|not|aren['’]t|are not|wasn['’]t|was not)\s+(?:just|only|merely|simply)\b[^.!?\n]{1,80}[,;—–-]\s*(?:it['’]s|it is|they['’]re|they are|but)\b/i;
const MAX_EM_DASHES = 2;

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What in the copy reads as machine-written, as short readable names. Empty = nothing found. */
export function aiTellsIn(text: string): string[] {
  const out: string[] = [];
  for (const p of AI_TELL_PHRASES) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) out.push(`"${p}"`);
  }
  if (NOT_JUST.test(text)) out.push(`"not just X, it's Y" turn`);
  const dashes = (text.match(/—/g) ?? []).length;
  if (dashes > MAX_EM_DASHES) out.push(`${dashes} em dashes`);
  return out;
}
