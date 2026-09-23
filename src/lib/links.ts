import "server-only";
import crypto from "node:crypto";

/**
 * Short codes for /l/<code>.
 *
 * No vowels, no look-alikes (0/O, 1/l/I): these get read off screens, typed by
 * hand and pasted into posts, and an ambiguous code is a dead click.
 */
const ALPHABET = "23456789bcdfghjkmnpqrstvwxyz";

export function newLinkCode(length = 7) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** The public origin short links are built against. */
export function appOrigin() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function shortUrl(code: string) {
  return `${appOrigin()}/l/${code}`;
}

/**
 * Builds the URL the visitor actually lands on: the destination plus UTMs.
 *
 * Parameters the destination already carries win — a hand-tuned link someone
 * pasted in is a deliberate act, and this should not quietly overwrite it.
 */
export function withUtm(destination: string, utm: {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
}) {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return destination;
  }
  const params: [string, string | null | undefined][] = [
    ["utm_source", utm.source],
    ["utm_medium", utm.medium],
    ["utm_campaign", utm.campaign],
    ["utm_content", utm.content],
  ];
  for (const [key, value] of params) {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * A per-day, keyed digest of who clicked — enough to separate one person's ten
 * clicks from ten people's, and not enough to identify anyone. The date in the
 * input means it stops being linkable to a visitor at midnight UTC, and the
 * app secret means it cannot be recomputed from outside.
 */
export function visitorHash(ip: string | null, userAgent: string | null) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHmac("sha256", process.env.APP_SECRET ?? "ggsocial")
    .update(`${day}|${ip ?? ""}|${userAgent ?? ""}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Coarse on purpose: enough to read a report, not enough to profile anyone. */
export function deviceFrom(userAgent: string | null) {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (/bot|crawler|spider|crawling|facebookexternalhit|slackbot|preview|whatsapp|embedly|iframely|skypeuripreview|vkshare|headless|curl|wget|python-requests/.test(ua)) return "bot";
  if (/mobile|android|iphone|ipad|ipod/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Link previews are not visits. Every platform fetches a URL when you paste it
 * to build a card, and counting those makes a post look like it worked before
 * anyone has seen it.
 */
export function isBotAgent(userAgent: string | null) {
  return deviceFrom(userAgent) === "bot";
}

/** A pasted destination made into a full http(s) URL, or a readable error. */
export function normalizeDestination(raw: string) {
  const value = raw.trim();
  if (!value) throw new Error("Where should the link go?");
  // People paste "moksy.ai/pricing" far more often than they type the scheme.
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${raw}" is not a URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Links must be http or https.");
  return url.toString();
}
