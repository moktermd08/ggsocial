/**
 * The maths behind the daily tuning job, kept pure so it can be read and
 * tested on its own: given when a brand's posts in one format went out and
 * how they did, which posting windows the numbers favour — if any.
 */
import { coerceLimit, inWindows, parseWindows } from "./check";

/** Fewer published posts than this in a format and the numbers are noise. */
export const MIN_SAMPLE = 10;
/** A two-hour slot needs this many posts before it can be called best. */
export const MIN_PER_SLOT = 3;
/** The best slots must beat the current windows by this much before anything is suggested. */
export const MIN_LIFT = 1.2;

/** One published post: minute of the day it went out (brand time), and its engagement rate in %. */
export type Scored = { minute: number; rate: number };

export type WindowSuggestion = {
  windows: string;
  bestAvg: number;
  /** The rate inside the current windows, or overall when too few posts fell inside them. */
  base: number;
  baseIsCurrent: boolean;
  best: { start: number; posts: number; avg: number }[];
};

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Adjacent two-hour slots merged: 18 and 20 → "18:00-22:00". */
export function slotsToWindows(starts: number[]) {
  const sorted = [...starts].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === s) last[1] = s + 2;
    else out.push([s, s + 2]);
  }
  return out.map(([a, b]) => `${String(a).padStart(2, "0")}:00-${String(b % 24).padStart(2, "0")}:00`).join(", ");
}

/**
 * The two best two-hour slots, when they clearly beat what the rule says now.
 * null = keep the current windows (too little data, or no clear winner).
 */
export function suggestWindows(scored: Scored[], current: string | undefined): WindowSuggestion | null {
  if (scored.length < MIN_SAMPLE) return null;
  const slots = new Map<number, number[]>();
  for (const s of scored) {
    const start = Math.floor(s.minute / 120) * 2;
    (slots.get(start) ?? slots.set(start, []).get(start)!).push(s.rate);
  }
  const ranked = [...slots.entries()].filter(([, v]) => v.length >= MIN_PER_SLOT)
    .map(([start, v]) => ({ start, posts: v.length, avg: mean(v) }))
    .sort((a, b) => b.avg - a.avg);
  if (ranked.length < 2) return null;

  const best = ranked.slice(0, 2);
  const bestAvg = mean(best.flatMap((b) => slots.get(b.start)!));
  const inside = scored.filter((s) => inWindows(s.minute, parseWindows(current))).map((s) => s.rate);
  const baseIsCurrent = inside.length >= MIN_PER_SLOT;
  const base = baseIsCurrent ? mean(inside) : mean(scored.map((s) => s.rate));
  if (bestAvg <= 0 || bestAvg < base * MIN_LIFT) return null;

  const windows = slotsToWindows(best.map((b) => b.start));
  if (current && windows === coerceLimit("windows", current)) return null;
  return { windows, bestAvg, base, baseIsCurrent, best };
}
