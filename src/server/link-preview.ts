import "server-only";
import { lookup } from "node:dns/promises";
import { privateAddress } from "@/server/page-checks";

/*
 * Link previews for short links.
 *
 * A platform building a card for /l/<code> follows the redirect and reads the
 * destination's own preview tags. When the destination has an image of its
 * own, that is the right card and the redirect is left alone. When it has
 * none, the card would be bare — so the crawler is answered here instead, with
 * the destination's title and description and the brand's social image.
 */

export type PageMeta = { title: string | null; description: string | null; image: string | null };

/** A crawler is waiting on the answer, so this gives up fast. */
const TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 4;
/** Preview tags live in <head>; reading stops there. */
const MAX_BODY = 512 * 1024;
const CACHE_MS = 6 * 60 * 60_000;
const CACHE_MAX = 500;

/** Every platform fetches a pasted link once or twice; the destination does not need visiting each time. */
const cache = new Map<string, { at: number; meta: PageMeta | null }>();

async function publicHost(url: URL) {
  try {
    const addrs = await lookup(url.hostname, { all: true });
    return addrs.length > 0 && !addrs.some((a) => privateAddress(a.address));
  } catch {
    return false;
  }
}

async function readHead(res: Response) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>|<body[\s>]/i.test(html)) break;
  }
  await reader.cancel().catch(() => {});
  return html;
}

function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** The content of a <meta> tag by property or name, whichever order its attributes come in. */
function metaContent(html: string, key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const id = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id?.toLowerCase() !== key) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    const clean = content && decodeEntities(content).replace(/\s+/g, " ").trim();
    if (clean) return clean;
  }
  return null;
}

export function parseMeta(html: string, base: URL): PageMeta {
  const docTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const title = metaContent(html, "og:title") ?? metaContent(html, "twitter:title")
    ?? (docTitle ? decodeEntities(docTitle).replace(/\s+/g, " ").trim() || null : null);
  const description = metaContent(html, "og:description") ?? metaContent(html, "twitter:description") ?? metaContent(html, "description");
  const rawImage = metaContent(html, "og:image") ?? metaContent(html, "og:image:url") ?? metaContent(html, "twitter:image");
  let image: string | null = null;
  if (rawImage) {
    try { image = new URL(rawImage, base).toString(); } catch { image = null; }
  }
  return { title, description, image };
}

/**
 * The destination's preview tags, or null when it could not be read. Only
 * public hosts are visited, redirect by redirect, so a link cannot be used to
 * look inside the server's own network.
 */
export async function destinationMeta(destination: string): Promise<PageMeta | null> {
  const hit = cache.get(destination);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.meta;

  const meta = await fetchMeta(destination);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(destination, { at: Date.now(), meta });
  return meta;
}

async function fetchMeta(destination: string): Promise<PageMeta | null> {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return null;
  }
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      if (!(await publicHost(url))) return null;
      const res = await fetch(url, {
        redirect: "manual",
        signal: deadline,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; ggsocial-linkpreview/1.0)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!next) return null;
        url = new URL(next, url);
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return parseMeta(await readHead(res), url);
    }
    return null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The page a crawler sees: preview tags for the card, and a refresh and a
 * link onward for anything that renders it. og:url is the short link itself,
 * because Facebook re-reads whatever og:url names — pointing it at the
 * destination would send it straight back to the bare card.
 */
export function previewHtml(p: {
  shortUrl: string; destination: string; siteName: string;
  title: string; description: string | null; image: string;
}) {
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${esc(p.shortUrl)}">`,
    `<meta property="og:site_name" content="${esc(p.siteName)}">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    p.description && `<meta property="og:description" content="${esc(p.description)}">`,
    p.description && `<meta name="description" content="${esc(p.description)}">`,
    `<meta property="og:image" content="${esc(p.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(p.title)}">`,
    p.description && `<meta name="twitter:description" content="${esc(p.description)}">`,
    `<meta name="twitter:image" content="${esc(p.image)}">`,
    `<meta name="robots" content="noindex">`,
    `<meta http-equiv="refresh" content="0;url=${esc(p.destination)}">`,
  ].filter(Boolean).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${esc(p.title)}</title>
${tags}
</head><body><a href="${esc(p.destination)}">${esc(p.title)}</a></body></html>`;
}
