import "server-only";
import { EMOJI_POLICIES, type BrandColor, type BrandLink, type EmojiPolicy } from "@/lib/db";
import { normalizeHex } from "@/lib/color";
import type { BookRow } from "@/lib/brand-book";

/*
 * Reading brand-book forms. Shared by the brand page and the master brand
 * book, which post the same field names.
 */

/** Trimmed string, or null — empty inputs should clear the column, not store "". */
export function str(fd: FormData, key: string) {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}

/** A textarea or comma list read back as a deduped array of lines. */
export function list(fd: FormData, key: string) {
  const seen = new Set<string>();
  for (const raw of String(fd.get(key) ?? "").split(/[\n,]/)) {
    const v = raw.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

export function hashtags(fd: FormData, key: string) {
  return list(fd, key).map((t) => (t.startsWith("#") ? t : `#${t}`).replace(/\s+/g, ""));
}

export function hex(fd: FormData, key: string, fallback: string) {
  return normalizeHex(String(fd.get(key) ?? "")) ?? fallback;
}

/** Repeatable rows arrive as parallel `key.a` / `key.b` lists. */
export function rows<T>(fd: FormData, a: string, b: string, build: (a: string, b: string) => T) {
  const as = fd.getAll(a).map(String);
  const bs = fd.getAll(b).map(String);
  const out: T[] = [];
  for (let i = 0; i < as.length; i++) {
    const left = (as[i] ?? "").trim();
    const right = (bs[i] ?? "").trim();
    if (left || right) out.push(build(left, right));
  }
  return out;
}

/**
 * Repeatable rows with any number of fields, posted as parallel
 * `prefix.field` lists. Rows with every field blank are dropped.
 */
export function records<K extends string>(fd: FormData, prefix: string, fields: readonly K[]): Record<K, string>[] {
  const cols = fields.map((f) => fd.getAll(`${prefix}.${f}`).map((v) => String(v).trim()));
  const count = Math.max(0, ...cols.map((c) => c.length));
  const out: Record<K, string>[] = [];
  for (let i = 0; i < count; i++) {
    const row = Object.fromEntries(fields.map((f, j) => [f, cols[j][i] ?? ""])) as Record<K, string>;
    if (fields.some((f) => row[f])) out.push(row);
  }
  return out;
}

export function palette(fd: FormData): BrandColor[] {
  return rows(fd, "palette.name", "palette.hex", (name, h) => ({
    name: name || "Untitled",
    hex: normalizeHex(h) ?? "#6366f1",
  }));
}

export function links(fd: FormData): BrandLink[] {
  return rows(fd, "links.label", "links.url", (label, url) => ({ label: label || url, url }))
    .filter((l) => l.url);
}

export function year(fd: FormData, key: string) {
  const n = Number(String(fd.get(key) ?? "").trim());
  if (!Number.isInteger(n) || n < 1800 || n > new Date().getFullYear() + 1) return null;
  return n;
}

export function emojiPolicy(fd: FormData): EmojiPolicy {
  const v = String(fd.get("emojiPolicy") ?? "free");
  return (EMOJI_POLICIES as readonly string[]).includes(v) ? (v as EmojiPolicy) : "free";
}

/** Every brand-book field that inherits from the master, read from one form. */
export function bookPatch(fd: FormData): BookRow {
  return {
    brief: str(fd, "brief"),
    voice: str(fd, "voice"),
    audience: str(fd, "audience"),
    valueProps: list(fd, "valueProps"),
    bannedWords: list(fd, "bannedWords").map((w) => w.toLowerCase()),
    defaultHashtags: hashtags(fd, "defaultHashtags"),
    emojiPolicy: emojiPolicy(fd),
    ctaText: str(fd, "ctaText"),
    boilerplate: str(fd, "boilerplate"),
    fontHeading: str(fd, "fontHeading"),
    fontBody: str(fd, "fontBody"),
    logoUsage: str(fd, "logoUsage"),
    imageStyle: str(fd, "imageStyle"),
    links: links(fd),
  };
}
