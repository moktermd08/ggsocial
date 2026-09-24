/**
 * The media catalogue: how a library file is filed (category, subcategory,
 * keywords), where it is suitable (uses, orientation) and a ranked search over
 * all of it. Plain functions, so the library page, the composer, the agent API
 * and the writer agent all find the same file for the same words.
 */

/** Starter shelves. A library may add its own; these are offered first. */
export const MEDIA_CATEGORIES: { name: string; subcategories: string[] }[] = [
  { name: "Product", subcategories: ["Hero shot", "Close-up", "In use", "Packaging", "Range / collection"] },
  { name: "Service", subcategories: ["In action", "Before and after", "Process", "Results"] },
  { name: "People", subcategories: ["Team", "Founder", "Customers", "Portrait", "Group"] },
  { name: "Place", subcategories: ["Premises", "Exterior", "Interior", "Local area"] },
  { name: "Lifestyle", subcategories: ["Everyday", "Work", "Home", "Outdoors"] },
  { name: "Event", subcategories: ["Launch", "Workshop", "Community", "Awards"] },
  { name: "Behind the scenes", subcategories: ["Making", "Office", "Planning"] },
  { name: "Proof", subcategories: ["Testimonial", "Review", "Case study", "Award", "Stat"] },
  { name: "Promotion", subcategories: ["Offer", "Sale", "Announcement", "Call to action"] },
  { name: "Education", subcategories: ["Tip", "How-to", "Infographic", "Checklist", "Quote"] },
  { name: "Seasonal", subcategories: ["Christmas", "New Year", "Eid", "Ramadan", "Summer", "Black Friday"] },
  { name: "Brand", subcategories: ["Logo", "Pattern", "Colour block", "Icon", "Signature"] },
  { name: "Background", subcategories: ["Texture", "Abstract", "Plain", "Scenic"] },
];

/** Where a file can go. Codes are stored; labels are shown. */
export const MEDIA_USES = [
  { code: "feed", label: "Feed post" },
  { code: "carousel", label: "Carousel slide" },
  { code: "story", label: "Story / reel cover" },
  { code: "banner", label: "Cover / banner" },
  { code: "profile", label: "Profile picture" },
  { code: "ad", label: "Ad creative" },
  { code: "web", label: "Website / blog" },
  { code: "email", label: "Email" },
  { code: "thumbnail", label: "Video thumbnail" },
  { code: "background", label: "Background for text" },
  { code: "print", label: "Print" },
] as const;
export type MediaUse = (typeof MEDIA_USES)[number]["code"];
export const USE_CODES = MEDIA_USES.map((u) => u.code) as string[];
export const labelForUse = (code: string) => MEDIA_USES.find((u) => u.code === code)?.label ?? code;

export type Orientation = "square" | "portrait" | "landscape";

export function orientationOf(width?: number | null, height?: number | null): Orientation | null {
  if (!width || !height) return null;
  const r = width / height;
  if (r > 0.9 && r < 1.1) return "square";
  return r < 1 ? "portrait" : "landscape";
}

/** What search and the filters read. Anything catalogue-less still has a name. */
export type Catalogued = {
  kind: string;
  originalName: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  tags?: string[];
  category?: string | null;
  subcategory?: string | null;
  uses?: string[];
  usageNotes?: string | null;
  catalogedAt?: string | Date | null;
};

export type MediaQuery = {
  /** Free words: "coffee cup morning", "team photo". */
  q?: string;
  category?: string;
  subcategory?: string;
  use?: string;
  orientation?: Orientation;
  kind?: string;
  /** Only files nobody has catalogued yet. */
  uncatalogued?: boolean;
};

const STOP = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "at", "by", "is", "our", "your", "image", "photo", "picture"]);

export function words(text: string) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a file passes the hard filters (everything but the words). */
export function matchesFilters(m: Catalogued, f: MediaQuery) {
  if (f.kind && m.kind !== f.kind) return false;
  if (f.category && !same(m.category, f.category)) return false;
  if (f.subcategory && !same(m.subcategory, f.subcategory)) return false;
  if (f.use && !(m.uses ?? []).includes(f.use)) return false;
  if (f.orientation && orientationOf(m.width, m.height) !== f.orientation) return false;
  if (f.uncatalogued && m.catalogedAt) return false;
  return true;
}

/**
 * How well a file answers some words. Keywords and the category count most,
 * then the description, then the file name; a word that only starts a longer
 * one ("coff" → "coffee") counts for less. 0 = no word matched.
 */
export function scoreMedia(m: Catalogued, q: string) {
  const want = words(q);
  if (want.length === 0) return 1;
  const fields: [string[], number][] = [
    [(m.tags ?? []).flatMap(words), 5],
    [words(`${m.category ?? ""} ${m.subcategory ?? ""}`), 4],
    [(m.uses ?? []).flatMap((u) => words(`${u} ${labelForUse(u)}`)), 2],
    [words(m.altText ?? ""), 3],
    [words(m.originalName.replace(/\.[a-z0-9]+$/i, "")), 1],
  ];
  let score = 0;
  let hit = 0;
  for (const w of want) {
    let best = 0;
    for (const [list, weight] of fields) {
      if (list.includes(w)) best = Math.max(best, weight);
      else if (w.length >= 3 && list.some((x) => x.startsWith(w) || (x.length >= 4 && w.startsWith(x)))) best = Math.max(best, weight / 2);
    }
    if (best) hit++;
    score += best;
  }
  // Files that answer more of the words rank above one strong match.
  return hit ? score * (hit / want.length) : 0;
}

/** Filters, then ranks by the words (catalogued files first on a tie). */
export function searchMedia<T extends Catalogued>(items: T[], f: MediaQuery): T[] {
  const scored = items
    .filter((m) => matchesFilters(m, f))
    .map((m, i) => ({ m, i, s: scoreMedia(m, f.q ?? "") }))
    .filter((x) => x.s > 0);
  if (!f.q?.trim()) return scored.map((x) => x.m);
  return scored.sort((a, b) => b.s - a.s || Number(!!b.m.catalogedAt) - Number(!!a.m.catalogedAt) || a.i - b.i).map((x) => x.m);
}

/** The shelves in use in a library, starter ones first, each with its subcategories. */
export function categoriesIn(items: Catalogued[]) {
  const out = new Map<string, Set<string>>();
  for (const c of MEDIA_CATEGORIES) out.set(c.name, new Set(c.subcategories));
  for (const m of items) {
    if (!m.category) continue;
    const key = [...out.keys()].find((k) => same(k, m.category)) ?? m.category.trim();
    const subs = out.get(key) ?? new Set<string>();
    if (m.subcategory) subs.add(m.subcategory.trim());
    out.set(key, subs);
  }
  return [...out].map(([name, subs]) => ({ name, subcategories: [...subs] }));
}

/** Tidies what a person or Claude typed into the shape that is stored. */
export function cleanCatalog(input: {
  altText?: string | null; category?: string | null; subcategory?: string | null;
  tags?: string[]; uses?: string[]; usageNotes?: string | null;
}) {
  const text = (s?: string | null, max = 500) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
  const tags = [...new Set((input.tags ?? []).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))].slice(0, 40);
  return {
    altText: text(input.altText, 1000),
    category: text(input.category, 60),
    subcategory: input.category ? text(input.subcategory, 60) : null,
    tags,
    uses: [...new Set((input.uses ?? []).filter((u) => USE_CODES.includes(u)))],
    usageNotes: text(input.usageNotes, 1000),
  };
}

/** The words in a query a file answers — why it was picked, for whoever checks. */
export function matchedWords(m: Catalogued, q: string) {
  return [...new Set(words(q))].filter((w) => scoreMedia(m, w) > 0);
}

/**
 * The use and shape a post's format calls for: stories and reels want
 * portrait, most feeds square, banners wide. Null = no preference.
 */
export function fitForFormat(format?: string | null): { use: string; orientation: Orientation | null } | null {
  const f = (format ?? "").toLowerCase();
  if (/story|reel|short|tiktok/.test(f)) return { use: "story", orientation: "portrait" };
  if (/carousel/.test(f)) return { use: "carousel", orientation: null };
  if (/cover|banner/.test(f)) return { use: "banner", orientation: "landscape" };
  if (/ad/.test(f)) return { use: "ad", orientation: null };
  if (/article|newsletter|blog/.test(f)) return { use: "web", orientation: "landscape" };
  if (/post|feed/.test(f)) return { use: "feed", orientation: null };
  return null;
}

/**
 * Ranks a library against a piece of writing (a post, an idea) rather than a
 * search box: every distinct word counts, fitting the format's use and shape
 * adds a little, and a file must answer at least `minWords` of them.
 */
export function rankForText<T extends Catalogued>(items: T[], text: string, opts: { format?: string | null; minWords?: number; kind?: string } = {}) {
  const want = [...new Set(words(text))];
  const fit = fitForFormat(opts.format);
  const minWords = opts.minWords ?? 2;
  return items
    .filter((m) => (opts.kind ? m.kind === opts.kind : m.kind === "image" || m.kind === "video"))
    .map((m) => {
      const matched = want.filter((w) => scoreMedia(m, w) > 0);
      const base = matched.reduce((s, w) => s + scoreMedia(m, w), 0);
      const fitsUse = !!fit && (m.uses ?? []).includes(fit.use);
      const fitsShape = !!fit?.orientation && orientationOf(m.width, m.height) === fit.orientation;
      return { item: m, matched, fitsUse, fitsShape, score: base + (fitsUse ? 3 : 0) + (fitsShape ? 2 : 0) };
    })
    .filter((r) => r.matched.length >= Math.min(minWords, want.length))
    .sort((a, b) => b.score - a.score);
}
