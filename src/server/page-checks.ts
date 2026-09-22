import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, activityChecks, activityTemplates, brandActivitySettings, brands, channels, PAGE_STATUSES } from "@/lib/db";
import { periodFor, todayIn } from "@/lib/activities/periods";
import { hasPublicPage, platformOrNull } from "@/lib/platforms";
import { ensureActivityLibrary, recordChecks, type Actor } from "@/server/activities";

/**
 * Visits each channel's public page and records whether it is still there,
 * then ticks the brand's daily "confirm each page is live" activity (D-00)
 * from what it found.
 *
 * A page is "down" only on a clear signal: 404/410, a domain that no longer
 * resolves, or a title that says the page is gone. Big platforms often block
 * bots (LinkedIn answers 999) or bounce them to a login wall; those come out as
 * "unknown" and the activity is left for a person to finish.
 */

export type PageStatus = (typeof PAGE_STATUSES)[number];
export type PageResult = { status: PageStatus; note: string };

const CODE = "D-00";
const CHECKER: Actor = { kind: "ai", name: "Page checker", userId: null };
/** How long a result stands before the page is visited again. */
const RECHECK_MS = 6 * 60 * 60_000;
/** A result older than this no longer counts towards today's tick. */
const FRESH_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
/** YouTube and Pinterest put the <title> over a megabyte into the page; reading stops once it arrives. */
const MAX_BODY = 3 * 1024 * 1024;
const PARALLEL = 4;

const GONE = /page not found|page isn.t available|content isn.t available|this account doesn.t exist|account (?:has been )?suspended|user not found|channel (?:does not|doesn.t) exist|this page (?:does not|doesn.t) exist|sorry, this page|\b404\b/i;
const GENERIC_TITLE = /^(?:instagram|threads|reddit(?: - .*)?|tiktok(?: - make your day)?|pinterest|x|twitter|facebook|linkedin|error|log ?in(?: .*)?|sign ?up(?: .*)?)$/i;
const LOGIN_WALL = /\/(?:login|signin|sign-in|accounts\/login|authwall|checkpoint|uas\/login)\b/i;

/** Only public web pages; never the server's own network. */
export function normalisePageUrl(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error("That page URL doesn't look right. Paste the full address, e.g. https://www.instagram.com/yourbrand");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The page URL must start with https://");
  if (!url.hostname.includes(".")) throw new Error("The page URL needs a full domain, e.g. instagram.com");
  return url.toString();
}

function privateAddress(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Resolves the host itself so a saved URL can't be pointed at internal services. */
async function assertPublicHost(url: URL): Promise<PageResult | null> {
  try {
    const addrs = await lookup(url.hostname, { all: true });
    if (addrs.some((a) => privateAddress(a.address))) return { status: "unknown", note: "Not checked: the address points to a private network" };
    return null;
  } catch {
    return { status: "down", note: `The domain ${url.hostname} no longer resolves` };
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
    // og:title sits next to <title> wherever a page puts it, so a little past it is enough.
    const end = html.search(/<\/title>/i);
    if (end >= 0 && html.length > end + 4096) break;
  }
  await reader.cancel().catch(() => {});
  return html;
}

function pageTitle(html: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return [title, og].map((s) => s?.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
}

export async function checkPageUrl(raw: string): Promise<PageResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { status: "down", note: "The saved URL is not a valid address" };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await assertPublicHost(url);
    if (blocked) return blocked;
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-GB,en;q=0.9",
        },
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return { status: "unknown", note: timedOut ? "The page took too long to answer" : "Couldn't connect to the page" };
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!next) return { status: "unknown", note: `HTTP ${res.status} with nowhere to go` };
      url = new URL(next, url);
      if (LOGIN_WALL.test(url.pathname)) return { status: "unknown", note: "The platform sent the checker to a login page" };
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => {});
      return { status: "down", note: `HTTP ${res.status}: the page doesn't exist` };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: "unknown", note: `HTTP ${res.status}: the platform blocked or refused the checker` };
    }
    const title = pageTitle(await readHead(res).catch(() => ""));
    if (title && GONE.test(title)) return { status: "down", note: `The page says: ${title.slice(0, 120)}` };
    // Instagram, Threads, Reddit, TikTok and Pinterest answer 200 with the same bare shell
    // for accounts that don't exist, so a 200 only counts when the page names someone.
    if (!title || title.split(" · ").every((part) => GENERIC_TITLE.test(part))) {
      return { status: "unknown", note: "The platform only showed its sign-in shell, so the page couldn't be confirmed" };
    }
    return { status: "live", note: `Loaded: ${title.slice(0, 120)}` };
  }
  return { status: "unknown", note: "Too many redirects" };
}

async function inBatches<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(work));
}

/** Checks the given channels now and saves what each page looked like. */
export async function checkChannelPages(channelIds: string[]) {
  if (channelIds.length === 0) return [];
  const rows = await db.select({ id: channels.id, brandId: channels.brandId, pageUrl: channels.pageUrl }).from(channels)
    .where(inArray(channels.id, channelIds));
  const results: { channelId: string; brandId: string; status: PageStatus; note: string }[] = [];
  await inBatches(rows.filter((r) => r.pageUrl), PARALLEL, async (r) => {
    const result = await checkPageUrl(r.pageUrl!);
    await db.update(channels).set({ pageStatus: result.status, pageNote: result.note, pageCheckedAt: new Date() })
      .where(eq(channels.id, r.id));
    results.push({ channelId: r.id, brandId: r.brandId, ...result });
  });
  return results;
}

const label = (c: { platform: string; handle: string }) => `${platformOrNull(c.platform)?.name ?? c.platform} ${c.handle}`;

/**
 * Ticks D-00 for today, in each brand's timezone, from the latest page
 * results. Leaves alone anything a person or agent recorded themselves, and
 * brands that have switched the activity off.
 */
export async function recordPageChecks(brandIds: string[]) {
  if (brandIds.length === 0) return 0;
  await ensureActivityLibrary();
  const template = await db.query.activityTemplates.findFirst({ where: eq(activityTemplates.code, CODE) });
  if (!template || template.archivedAt) return 0;

  const [brandRows, channelRows, settings] = await Promise.all([
    db.select({ id: brands.id, timezone: brands.timezone }).from(brands)
      .where(and(inArray(brands.id, brandIds), isNull(brands.archivedAt))),
    db.select().from(channels).where(and(inArray(channels.brandId, brandIds), isNull(channels.archivedAt))),
    db.select().from(brandActivitySettings)
      .where(and(inArray(brandActivitySettings.brandId, brandIds), eq(brandActivitySettings.templateId, template.id))),
  ]);

  const now = Date.now();
  let recorded = 0;
  for (const brand of brandRows) {
    if (settings.find((s) => s.brandId === brand.id)?.enabled === false) continue;
    // Senders and inboxes have no page to visit, so they are not part of this check at all.
    const list = channelRows.filter((c) => c.brandId === brand.id && hasPublicPage(c.platform));
    if (list.length === 0) continue;
    // Nothing to go on until at least one page URL is saved; the activity stays with the team.
    if (!list.some((c) => c.pageUrl)) continue;

    const fresh = (c: (typeof list)[number]) => c.pageUrl && c.pageCheckedAt && now - c.pageCheckedAt.getTime() < FRESH_MS;
    const live = list.filter((c) => fresh(c) && c.pageStatus === "live");
    const down = list.filter((c) => fresh(c) && c.pageStatus === "down");
    const unsure = list.filter((c) => c.pageUrl && !live.includes(c) && !down.includes(c));
    const noUrl = list.filter((c) => !c.pageUrl);

    const lines = [
      ...down.map((c) => `Down: ${label(c)} (${c.pageNote}) ${c.pageUrl}`),
      ...unsure.map((c) => `Check by hand: ${label(c)} (${c.pageNote ?? "not checked yet"}) ${c.pageUrl}`),
      ...noUrl.map((c) => `No page URL saved: ${label(c)}. Add it on the Channels page`),
    ];
    const status = lines.length === 0 ? "done" : "partial";
    const notes = status === "done" ? `All ${live.length} pages loaded and look like ours.` : lines.join("\n");
    const proofUrl = (down[0] ?? unsure[0] ?? live[0])?.pageUrl ?? null;

    const today = todayIn(brand.timezone);
    const period = periodFor(template.frequency, today);
    const existing = await db.query.activityChecks.findFirst({
      where: and(eq(activityChecks.brandId, brand.id), eq(activityChecks.templateId, template.id), eq(activityChecks.periodKey, period.key)),
    });
    if (existing && existing.source !== "auto") continue;
    if (existing && existing.status === status && existing.notes === notes && existing.count === live.length) continue;

    await recordChecks([{ brandId: brand.id, templateId: template.id, date: today, status, count: live.length, proofUrl, notes }], CHECKER, "auto");
    recorded++;
  }
  return recorded;
}

/** The cron job: re-visits every page that is due, then updates each brand's tick. */
export async function runPageChecks() {
  const cutoff = new Date(Date.now() - RECHECK_MS);
  const due = await db.select({ id: channels.id }).from(channels)
    .innerJoin(brands, eq(brands.id, channels.brandId))
    .where(and(
      isNull(channels.archivedAt), isNull(brands.archivedAt),
      isNotNull(channels.pageUrl),
      or(isNull(channels.pageCheckedAt), lt(channels.pageCheckedAt, cutoff)),
    ));
  const results = await checkChannelPages(due.map((d) => d.id));
  // Every active brand, not just the ones checked: a new day needs a fresh tick even when no page was due.
  const active = await db.select({ id: brands.id }).from(brands).where(isNull(brands.archivedAt));
  const recorded = await recordPageChecks(active.map((b) => b.id));
  return {
    checked: results.length,
    down: results.filter((r) => r.status === "down").map((r) => ({ channelId: r.channelId, note: r.note })),
    unknown: results.filter((r) => r.status === "unknown").length,
    recorded,
  };
}
