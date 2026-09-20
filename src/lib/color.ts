/**
 * Colour maths for brand-supplied hexes. Brands pick their own colours, so
 * anything we paint on top of one has to be chosen at render time — hard-coding
 * white text on an arbitrary swatch is how you end up with unreadable chips.
 */

function parse(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const rgb = parse(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hexes, 1 to 21. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The true extremes: on a mid-tone brand hex like #6366f1 nothing else clears
// 4.5:1, and softening the ink to #101014 drops it from 4.70 to 4.43.
const INK = "#000000";
const PAPER = "#ffffff";

/** Ink or paper — whichever reads better on `hex`. */
export function readableOn(hex: string) {
  return contrast(hex, INK) >= contrast(hex, PAPER) ? INK : PAPER;
}

export function isValidHex(hex: string) {
  return parse(hex) !== null;
}

/** Normalises user input ("6366F1", "#6366f1") to "#6366f1", or null. */
export function normalizeHex(hex: string) {
  const rgb = parse(hex);
  if (!rgb) return null;
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A tint of `hex` that stays legible as text in both themes: blended toward
 * whatever `--text` currently is, so it darkens on light and lightens on dark.
 */
export function tintedInk(hex: string, strength = 68) {
  return `color-mix(in oklab, ${hex} ${strength}%, var(--text))`;
}

export function tintedSurface(hex: string, strength = 14) {
  return `color-mix(in oklab, ${hex} ${strength}%, var(--surface))`;
}

export function tintedBorder(hex: string, strength = 42) {
  return `color-mix(in oklab, ${hex} ${strength}%, var(--border))`;
}
