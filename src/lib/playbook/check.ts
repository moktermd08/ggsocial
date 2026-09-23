/**
 * The playbook engine: which rule a piece of content falls under, the rule a
 * brand actually works to, and what a piece breaks. Client-safe, so the
 * composer checks as you type and the server, the review panel, Claude
 * drafting and the agent API all run exactly the same checks.
 */
import {
  LIMIT_KEYS, type ChecklistItem, type EnforceLevel, type LimitKey, type RuleKind, type RuleLimits,
} from "./meta";

/** One rule as a brand works to it: the master with this brand's adjustments applied. */
export type EffectiveRule = {
  id: string;
  code: string;
  kind: RuleKind;
  name: string;
  description: string;
  /** The master's instructions, then this brand's own notes. */
  instructions: string;
  brandNotes: string | null;
  platforms: string[];
  activityCodes: string[];
  enabled: boolean;
  enforce: EnforceLevel;
  limits: RuleLimits;
  checklist: ChecklistItem[];
  /** Which limits this brand has changed from the master. */
  customised: LimitKey[];
};

export type MasterRuleInput = {
  id: string; code: string; kind: RuleKind; name: string; description: string; instructions: string;
  platforms: string[]; activityCodes: string[]; enforce: EnforceLevel; limits: RuleLimits; checklist: ChecklistItem[];
};

export type BrandOverrideInput = {
  enabled: boolean | null;
  enforce: EnforceLevel | null;
  limits: RuleLimits;
  extraChecklist: ChecklistItem[];
  hiddenChecklist: string[];
  notes: string | null;
};

export function effectiveRule(master: MasterRuleInput, override?: BrandOverrideInput | null): EffectiveRule {
  const own = override?.limits ?? {};
  const limits: RuleLimits = { ...master.limits };
  const customised: LimitKey[] = [];
  for (const k of LIMIT_KEYS) {
    if (!(k in own)) continue;
    const v = own[k];
    if (v === null || v === undefined || v === "") delete limits[k];
    else (limits as Record<string, unknown>)[k] = v;
    if (v !== master.limits[k]) customised.push(k);
  }
  const hidden = new Set(override?.hiddenChecklist ?? []);
  return {
    id: master.id, code: master.code, kind: master.kind, name: master.name, description: master.description,
    instructions: master.instructions,
    brandNotes: override?.notes ?? null,
    platforms: master.platforms, activityCodes: master.activityCodes,
    enabled: override?.enabled ?? true,
    enforce: override?.enforce ?? master.enforce,
    limits,
    checklist: [...master.checklist.filter((i) => !hidden.has(i.id)), ...(override?.extraChecklist ?? [])],
    customised,
  };
}

/* ------------------------------------------------------ which rule applies */

const BLOG = new Set(["wordpress", "ghost", "webflow", "shopify_blog", "devto", "hashnode", "medium", "substack", "notion"]);
const EMAIL = new Set(["beehiiv", "mailchimp", "brevo", "convertkit", "klaviyo", "resend", "sendgrid"]);
const TEXT_FIRST = new Set(["x", "threads", "bluesky", "mastodon", "farcaster"]);
const SHORT_FIRST = new Set(["tiktok", "snapchat", "douyin", "kuaishou"]);
const COMMERCE = new Set(["facebook_marketplace", "etsy", "ebay", "amazon_posts", "olx", "craigslist", "gumtree", "bikroy", "daraz", "gumroad"]);

function fits(rule: { platforms: string[] }, platform: string) {
  return rule.platforms.length === 0 || rule.platforms.includes(platform);
}

/**
 * The format rule a target falls under. A post's chosen format wins where it
 * exists on that platform; otherwise the platform's own option (an Instagram
 * reel), then what is attached, then the plain feed post. Returns null when
 * the brand has switched the rule off, so nothing is checked.
 */
export function resolveFormat<R extends { code: string; name: string; kind: RuleKind; platforms: string[]; enabled: boolean }>(
  rules: R[],
  args: { platform: string; options?: Record<string, unknown>; postType?: string | null; media?: { kind: string }[] },
): R | null {
  const formats = rules.filter((r) => r.kind === "format");
  const byCode = (code: string) => formats.find((r) => r.code === code && fits(r, args.platform));
  const pick = (r: R | undefined) => (r ? (r.enabled ? r : null) : undefined);

  const wanted = args.postType?.trim().toLowerCase();
  if (wanted) {
    const chosen = formats.find((r) => (r.code === wanted || r.name.toLowerCase() === wanted) && fits(r, args.platform));
    if (chosen) return pick(chosen) ?? null;
  }

  const media = args.media ?? [];
  const videos = media.filter((m) => m.kind === "video").length;
  const images = media.filter((m) => m.kind === "image").length;
  const o = args.options ?? {};
  let code = "post";
  if (args.platform === "instagram") {
    code = o.format === "reel" ? "reel" : o.format === "story" ? "story" : media.length > 1 ? "carousel" : "post";
  } else if (COMMERCE.has(args.platform)) code = "listing";
  else if (BLOG.has(args.platform)) code = "article";
  else if (EMAIL.has(args.platform)) code = "newsletter";
  else if (SHORT_FIRST.has(args.platform)) code = "short";
  else if (args.platform === "x" && o.thread) code = "thread";
  else if (TEXT_FIRST.has(args.platform) && media.length === 0) code = "thread";
  else if (videos > 0) code = "video";
  else if (images > 1) code = "carousel";

  const found = pick(byCode(code));
  if (found !== undefined) return found;
  return pick(byCode("post")) ?? null;
}

/* ------------------------------------------------------------- the checks */

export type PlaybookIssue = { level: "error" | "warn"; rule: string; key: LimitKey | "size"; message: string };

export type CheckMedia = { kind: string; originalName: string; width?: number | null; height?: number | null; durationMs?: number | null };

export type CheckInput = {
  title: string;
  body: string;
  firstComment?: string | null;
  media: CheckMedia[];
  /** ISO instant. Timing is only checked once there is one. */
  scheduledAt?: string | null;
  timezone: string;
};

const HASHTAG = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;

/** Distinct hashtags across the copy and the first comment, where many brands put them. */
export function hashtagsIn(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(HASHTAG)) out.add(m[2].toLowerCase());
  return [...out];
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "mon-fri", "tue,thu,sat", "mon-sun" → the weekday numbers (0 = Sunday). Unreadable parts are ignored. */
export function parseDays(text: string | undefined): Set<number> | null {
  if (!text?.trim()) return null;
  const out = new Set<number>();
  for (const part of text.toLowerCase().split(/[,\s]+/).filter(Boolean)) {
    const [a, b] = part.split("-").map((s) => DAY_NAMES.indexOf(s.slice(0, 3)));
    if (a < 0) continue;
    if (b === undefined) { out.add(a); continue; }
    if (b < 0) continue;
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return out.size ? out : null;
}

/** "08:00-10:00, 18:00-20:30" → minute ranges. A window may run past midnight. */
export function parseWindows(text: string | undefined): { from: number; to: number; label: string }[] {
  if (!text?.trim()) return [];
  const out: { from: number; to: number; label: string }[] = [];
  for (const part of text.split(",")) {
    const m = part.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?$/);
    if (!m) continue;
    const from = Number(m[1]) * 60 + Number(m[2] ?? 0);
    const to = Number(m[3]) * 60 + Number(m[4] ?? 0);
    if (from > 24 * 60 || to > 24 * 60) continue;
    out.push({ from, to, label: `${fmt(from)}–${fmt(to)}` });
  }
  return out;
}

function fmt(min: number) {
  return `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Wall-clock minute of the day and weekday of an instant in a timezone. */
export function localClock(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return { minute: hour * 60 + Number(get("minute")), day: DAY_NAMES.indexOf(get("weekday").toLowerCase().slice(0, 3)), label: `${get("weekday")} ${fmt(hour * 60 + Number(get("minute")))}` };
}

export function inWindows(minute: number, windows: { from: number; to: number }[]) {
  return windows.some((w) => (w.from <= w.to ? minute >= w.from && minute < w.to : minute >= w.from || minute < w.to));
}

function ratioOf(text: string) {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  return m ? Number(m[1]) / Number(m[2]) : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Everything a piece breaks against one rule. Limits fail at the rule's
 * strictness; posting time is always advice; a file whose size the app could
 * not read is flagged for a person to check by eye rather than passed.
 */
export function checkContent(rule: Pick<EffectiveRule, "code" | "name" | "enforce" | "limits">, input: CheckInput): PlaybookIssue[] {
  const L = rule.limits;
  const level = rule.enforce === "block" ? "error" : "warn";
  const out: PlaybookIssue[] = [];
  const add = (key: PlaybookIssue["key"], message: string, lvl: "error" | "warn" = level) =>
    out.push({ level: lvl, rule: rule.code, key, message: `${rule.name}: ${message}` });

  const title = input.title.trim();
  const words = wordCount(title);
  if (L.titleRequired && !title) add("titleRequired", "needs a title.");
  if (L.titleMaxWords !== undefined && words > L.titleMaxWords) {
    add("titleMaxWords", `title is ${plural(words, "word")} — ${L.titleMaxWords} max.`);
  }

  const tags = hashtagsIn(`${input.body}\n${input.firstComment ?? ""}`);
  const min = L.hashtagsMin, max = L.hashtagsMax;
  if (min !== undefined && max !== undefined && min === max && tags.length !== min) {
    add("hashtagsMin", `${plural(tags.length, "hashtag")} — needs exactly ${min}.`);
  } else {
    if (min !== undefined && tags.length < min) add("hashtagsMin", `${plural(tags.length, "hashtag")} — needs at least ${min}.`);
    if (max !== undefined && tags.length > max) add("hashtagsMax", `${plural(tags.length, "hashtag")} — ${max} at most.`);
  }

  const len = input.body.trim().length;
  if (L.bodyMinChars !== undefined && len < L.bodyMinChars) add("bodyMinChars", `copy is ${len} characters — at least ${L.bodyMinChars}.`);
  if (L.bodyMaxChars !== undefined && len > L.bodyMaxChars) add("bodyMaxChars", `copy is ${len} characters — ${L.bodyMaxChars} at most.`);

  const media = input.media;
  if (L.mediaKind === "none" && media.length) add("mediaKind", "takes no media.");
  if ((L.mediaKind === "image" || L.mediaKind === "video") && media.some((m) => m.kind !== L.mediaKind)) {
    add("mediaKind", `${L.mediaKind} files only.`);
  }
  if (L.mediaMin !== undefined && media.length < L.mediaMin) add("mediaMin", `needs at least ${plural(L.mediaMin, "file")}.`);
  if (L.mediaMax !== undefined && media.length > L.mediaMax) add("mediaMax", `${L.mediaMax === 1 ? "one file only" : `${L.mediaMax} files at most`}.`);

  const ratios = (L.aspectRatio ?? "").split(",").map((r) => ({ text: r.trim(), value: ratioOf(r) })).filter((r) => r.value);
  const unsized: string[] = [];
  for (const m of media.filter((x) => x.kind === "image" || x.kind === "video")) {
    const sized = Boolean(m.width && m.height);
    if (!sized && (ratios.length || L.minWidth || L.minHeight)) unsized.push(m.originalName);
    if (sized) {
      const r = m.width! / m.height!;
      if (ratios.length && !ratios.some((x) => Math.abs(r - x.value!) / x.value! <= 0.03)) {
        add("aspectRatio", `${m.originalName} is ${m.width}×${m.height} — needs ${ratios.map((x) => x.text).join(" or ")}.`);
      }
      if (L.minWidth && m.width! < L.minWidth) add("minWidth", `${m.originalName} is ${m.width}px wide — at least ${L.minWidth}px.`);
      if (L.minHeight && m.height! < L.minHeight) add("minHeight", `${m.originalName} is ${m.height}px tall — at least ${L.minHeight}px.`);
    }
    if (m.kind === "video" && m.durationMs) {
      const s = Math.round(m.durationMs / 1000);
      if (L.videoMinSeconds !== undefined && s < L.videoMinSeconds) add("videoMinSeconds", `${m.originalName} runs ${s}s — at least ${L.videoMinSeconds}s.`);
      if (L.videoMaxSeconds !== undefined && s > L.videoMaxSeconds) add("videoMaxSeconds", `${m.originalName} runs ${s}s — ${L.videoMaxSeconds}s at most.`);
    }
  }
  if (unsized.length) {
    add("size", `couldn't read the size of ${unsized.join(", ")} — check by eye: ${sizeText(L) || "see the rule"}.`, "warn");
  }

  if (input.scheduledAt) {
    const clock = localClock(input.scheduledAt, input.timezone);
    const windows = parseWindows(L.windows);
    const days = parseDays(L.days);
    if (windows.length && !inWindows(clock.minute, windows)) {
      add("windows", `scheduled ${clock.label} — best times are ${windows.map((w) => w.label).join(", ")} (${input.timezone}).`, "warn");
    }
    if (days && !days.has(clock.day)) add("days", `scheduled on a ${clock.label.slice(0, 3)} — posting days are ${L.days}.`, "warn");
  }

  return out;
}

export type TargetCheck = {
  channelId: string;
  platform: string;
  rule: { code: string; name: string } | null;
  issues: PlaybookIssue[];
  checklist: ChecklistItem[];
};

/**
 * Every channel of a post against the rule its format falls under. Where a
 * platform has its own headline field (a YouTube title, an email subject)
 * that is the title checked; otherwise the post's title.
 */
export function checkTargets(rules: EffectiveRule[], post: {
  title: string; body: string; postType?: string | null; scheduledAt?: string | null; timezone: string; media: CheckMedia[];
  targets: { channelId: string; platform: string; bodyOverride?: string | null; firstComment?: string | null; options?: Record<string, unknown> }[];
}): TargetCheck[] {
  return post.targets.map((t) => {
    const rule = resolveFormat(rules, { platform: t.platform, options: t.options, postType: post.postType, media: post.media });
    if (!rule) return { channelId: t.channelId, platform: t.platform, rule: null, issues: [], checklist: [] };
    const o = t.options ?? {};
    const headline = [o.title, o.subject].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    return {
      channelId: t.channelId,
      platform: t.platform,
      rule: { code: rule.code, name: rule.name },
      issues: checkContent(rule, {
        title: headline ?? post.title,
        body: t.bodyOverride ?? post.body,
        firstComment: t.firstComment,
        media: post.media,
        scheduledAt: post.scheduledAt,
        timezone: post.timezone,
      }),
      checklist: rule.checklist,
    };
  });
}

function sizeText(L: RuleLimits) {
  const parts: string[] = [];
  if (L.aspectRatio) parts.push(L.aspectRatio);
  if (L.minWidth && L.minHeight) parts.push(`at least ${L.minWidth}×${L.minHeight}px`);
  else if (L.minWidth) parts.push(`at least ${L.minWidth}px wide`);
  else if (L.minHeight) parts.push(`at least ${L.minHeight}px tall`);
  return parts.join(", ");
}

/**
 * The rule in plain sentences, in a fixed order. What writers read in the
 * composer, what reviewers see, and what Claude and agents are handed — so
 * everyone works from the same words.
 */
export function describeRule(rule: Pick<EffectiveRule, "limits" | "enforce">): string[] {
  const L = rule.limits;
  const lines: string[] = [];
  if (L.titleRequired || L.titleMaxWords !== undefined) {
    lines.push(`Title: ${L.titleRequired ? "required" : "optional"}${L.titleMaxWords !== undefined ? `, ${L.titleMaxWords} words max` : ""}`);
  }
  if (L.hashtagsMin !== undefined || L.hashtagsMax !== undefined) {
    const a = L.hashtagsMin, b = L.hashtagsMax;
    lines.push(`Hashtags: ${a !== undefined && a === b ? `exactly ${a}` : b === 0 ? "none" : [a !== undefined ? `at least ${a}` : "", b !== undefined ? `at most ${b}` : ""].filter(Boolean).join(", ")}`);
  }
  if (L.bodyMinChars !== undefined || L.bodyMaxChars !== undefined) {
    lines.push(`Copy: ${[L.bodyMinChars !== undefined ? `at least ${L.bodyMinChars}` : "", L.bodyMaxChars !== undefined ? `at most ${L.bodyMaxChars}` : ""].filter(Boolean).join(", ")} characters`);
  }
  const media: string[] = [];
  if (L.mediaKind && L.mediaKind !== "any") media.push(L.mediaKind === "none" ? "no media" : `${L.mediaKind} only`);
  if (L.mediaMin !== undefined || L.mediaMax !== undefined) {
    media.push(L.mediaMin !== undefined && L.mediaMin === L.mediaMax ? plural(L.mediaMin, "file")
      : [L.mediaMin !== undefined ? `${L.mediaMin}+ files` : "", L.mediaMax !== undefined ? `up to ${L.mediaMax}` : ""].filter(Boolean).join(", "));
  }
  const size = sizeText(L);
  if (size) media.push(size);
  if (L.videoMinSeconds !== undefined || L.videoMaxSeconds !== undefined) {
    media.push(`video ${L.videoMinSeconds ?? 0}–${L.videoMaxSeconds ?? "∞"}s`);
  }
  if (media.length) lines.push(`Media: ${media.join("; ")}`);
  const timing: string[] = [];
  if (L.windows) timing.push(parseWindows(L.windows).map((w) => w.label).join(", ") || L.windows);
  if (L.days) timing.push(L.days);
  if (timing.length) lines.push(`Post at: ${timing.join(" · ")} (brand time)`);
  if (L.perWeek !== undefined) lines.push(`Cadence: ${L.perWeek} a week`);
  if (lines.length) lines.push(rule.enforce === "block" ? "These limits are a must: breaking one stops scheduling and approval (timing is advice)." : "These limits are advice: breaking one is flagged, not blocked.");
  return lines;
}

/* --------------------------------------------------------- value handling */

/** Limits and adjustment values travel as JSON text, so one column holds any of them. */
export function encodeValue(v: unknown) {
  // Keys sorted: Postgres hands jsonb objects back in its own key order, and
  // "unchanged" has to compare equal whichever way round they come.
  return v === undefined ? null : JSON.stringify(v, (_, x) => (
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x
  ));
}

export function decodeValue(text: string | null): unknown {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function readableValue(field: string, text: string | null) {
  const v = decodeValue(text);
  if (text === null) return "—";
  if (v === null || v === undefined || v === "") return "No limit";
  if (field === "checklist" && Array.isArray(v)) return (v as ChecklistItem[]).map((i) => `• ${i.text}`).join("\n");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Coerces typed input for one limit, or throws with a reason a person can act on. */
export function coerceLimit(key: LimitKey, raw: unknown): RuleLimits[LimitKey] | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (key === "titleRequired") return raw === true || raw === "true" || raw === "yes";
  if (key === "mediaKind") {
    const s = String(raw);
    if (!["any", "image", "video", "none"].includes(s)) throw new Error("Media type must be any, image, video or none.");
    return s as RuleLimits["mediaKind"];
  }
  if (key === "windows") {
    const s = String(raw).trim();
    const parsed = parseWindows(s);
    if (parsed.length !== s.split(",").filter((p) => p.trim()).length) throw new Error(`Posting windows look like "08:00-10:00, 18:00-20:00" — could not read "${s}".`);
    return parsed.map((w) => w.label.replace("–", "-")).join(", ");
  }
  if (key === "days") {
    const s = String(raw).trim().toLowerCase();
    if (!parseDays(s)) throw new Error(`Posting days look like "mon-fri" or "tue,thu" — could not read "${s}".`);
    return s;
  }
  if (key === "aspectRatio") {
    const s = String(raw).trim();
    if (s.split(",").some((r) => !ratioOf(r))) throw new Error(`Aspect ratio looks like "9:16" or "4:5, 1:1" — could not read "${s}".`);
    return s;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"${raw}" is not a number of 0 or more.`);
  return Math.round(n);
}
