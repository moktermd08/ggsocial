/**
 * The checks behind the playbook's "Brand details" rule: what the app can
 * tell about a brand page on its own, and the exact values every profile and
 * new registration copies. Client-safe.
 *
 * The brand page is the one source of truth for everything the brand says
 * about itself online. These checks catch what is missing, mistyped or
 * inconsistent; whether a detail is actually true stays a person's call and
 * is on the rule's checklist.
 */
import type { brands } from "@/lib/db/schema";

type Brand = typeof brands.$inferSelect;
type Channel = { platform: string; handle: string };

/** The brand page's section ids, so an issue can link to its card. */
export type DetailSection = "basics" | "identity" | "offering" | "market" | "contact" | "people" | "proof" | "visual" | "voice" | "links";

/** "fix" = something written is wrong or inconsistent; "fill" = something every profile needs is missing. */
export type DetailIssue = { section: DetailSection; field: string; level: "fix" | "fill"; message: string };

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Unsupported superlatives: fine with a number or a source beside them, not on their own. */
const VAGUE = /\b(best|leading|#1|number one|world[- ]class|top[- ]rated|award[- ]winning|premier|unrivall?ed)\b/i;
const PLACEHOLDER = /\b(lorem|ipsum|tbc|tbd|todo|xxx+|placeholder|example\.com|your (company|brand|name))\b/i;

function domainOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A handle compared the way people read it: no @, no URL, no case. null for
 * a page name ("Acme Robotics"), which some platforms store in place of a
 * handle and which the name check already covers.
 */
export function normalHandle(handle: string) {
  const h = handle.trim().toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^[@/]+|\/+$/g, "");
  return h && !/\s/.test(h) ? h : null;
}

/** The handle most channels use, which the rest should match. */
export function mainHandle(channels: Channel[]) {
  const counts = new Map<string, number>();
  for (const c of channels) {
    const h = normalHandle(c.handle);
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function checkBrandDetails(b: Brand, channels: Channel[]): DetailIssue[] {
  const out: DetailIssue[] = [];
  const add = (section: DetailSection, field: string, level: DetailIssue["level"], message: string) =>
    out.push({ section, field, level, message });
  const need = (section: DetailSection, field: string, value: unknown, why: string) => {
    if (value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0)) {
      add(section, field, "fill", why);
      return false;
    }
    return true;
  };

  /* Every free-text field the brand publishes about itself, for the checks that apply to all of them. */
  const texts: [DetailSection, string, string | null][] = [
    ["basics", "Name", b.name], ["basics", "Tagline", b.tagline],
    ["identity", "Legal name", b.legalName], ["identity", "Industry", b.industry],
    ["identity", "Headquarters", b.hqLocation], ["identity", "What the company does", b.description],
    ["contact", "Address", b.address], ["contact", "Opening hours", b.openingHours],
    ["voice", "Brief", b.brief], ["voice", "Default call to action", b.ctaText], ["voice", "Boilerplate", b.boilerplate],
    ...b.products.map((p) => ["offering", `Product "${p.name}"`, `${p.name} ${p.description}`] as [DetailSection, string, string]),
    ...b.services.map((s) => ["offering", `Service "${s.name}"`, `${s.name} ${s.description}`] as [DetailSection, string, string]),
    ...b.valueProps.map((v) => ["voice", "Key message", v] as [DetailSection, string, string]),
  ];
  const banned = b.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  for (const [section, field, value] of texts) {
    if (!value) continue;
    if (PLACEHOLDER.test(value)) add(section, field, "fix", "Looks like placeholder text. Replace it with the real detail or leave it empty.");
    if (value !== value.trim() || / {2,}/.test(value.replace(/\n/g, ""))) {
      add(section, field, "fix", "Has stray spaces. Profiles copy it character for character, so tidy it here.");
    }
    const lower = value.toLowerCase();
    const hit = banned.find((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower));
    if (hit) add(section, field, "fix", `Uses "${hit}", one of the brand's own words to avoid.`);
  }

  /* --------------------------------------------------------------- basics */
  if (b.name.length > 4 && b.name === b.name.toUpperCase()) {
    add("basics", "Name", "fix", "Write the name exactly as it appears on the logo, not in capitals.");
  }
  if (need("basics", "Tagline", b.tagline, "Every bio starts from the tagline. One sentence: what the brand does, for whom.")) {
    const words = b.tagline!.trim().split(/\s+/).length;
    if (words > 12) add("basics", "Tagline", "fix", `${words} words. Keep it to 12 or fewer so it fits every bio.`);
    if (/\n/.test(b.tagline!)) add("basics", "Tagline", "fix", "Keep the tagline to one line.");
  }
  const site = domainOf(b.website);
  if (need("basics", "Website", b.website, "The one address every profile links to.")) {
    if (!site) add("basics", "Website", "fix", "Not a valid web address.");
    else if (!b.website!.startsWith("https://")) add("basics", "Website", "fix", "Use the https:// address.");
    else if (/[?#]/.test(b.website!)) add("basics", "Website", "fix", "Use the clean home page address, without tracking or anchors.");
  }

  /* -------------------------------------------------------------- company */
  need("identity", "Legal name", b.legalName, "Exactly as on the company register. Listings and ads ask for it.");
  need("identity", "Industry", b.industry, "The category picked on Google Business, LinkedIn and every directory.");
  need("identity", "Headquarters", b.hqLocation, "City and country, the same on every profile.");
  if (b.foundedYear == null) add("identity", "Founded", "fill", "The year from the company record. LinkedIn, Google and Facebook all show it.");
  else if (b.foundedYear < 1800 || b.foundedYear > new Date().getFullYear()) add("identity", "Founded", "fix", "That year can't be right.");
  if (need("identity", "What the company does", b.description, "The source for every About section and long bio.")) {
    if (b.description!.trim().length < 150) {
      add("identity", "What the company does", "fix", "Too short to be specific. Say what it sells, to whom, where, and what makes it different.");
    }
    if (!b.description!.toLowerCase().includes(b.name.toLowerCase())) {
      add("identity", "What the company does", "fix", `Name the brand ("${b.name}") so it can be pasted anywhere as-is.`);
    }
  }

  /* ------------------------------------------------------------- offering */
  if (b.products.length + b.services.length === 0) {
    add("offering", "Products & services", "fill", "List what the brand actually sells, so profiles and posts name real things.");
  }
  for (const o of [...b.products, ...b.services]) {
    if (!o.description.trim()) add("offering", o.name || "Unnamed item", "fill", "Add one sentence: what it is and who it's for.");
    if (!o.url.trim()) add("offering", o.name || "Unnamed item", "fill", "Link to its own page, so profiles and shops point somewhere real.");
    else if (site && domainOf(o.url) && domainOf(o.url) !== site && !domainOf(o.url)!.endsWith(`.${site}`)) {
      add("offering", o.name || "Unnamed item", "fix", `Links off ${site}. Point it at the brand's own page.`);
    }
  }

  /* --------------------------------------------------------------- market */
  if (b.audienceSegments.length === 0) add("market", "Customer segments", "fill", "Name the real groups who buy.");
  need("market", "Markets", b.markets, "Name the countries, regions or cities the brand sells into.");

  /* -------------------------------------------------------------- contact */
  for (const [field, value] of [["Contact email", b.contactEmail], ["Support email", b.supportEmail]] as const) {
    if (!value) continue;
    if (!EMAIL.test(value.trim())) {
      add("contact", field, "fix", "Not a valid email address.");
      continue;
    }
    const d = value.trim().split("@")[1].toLowerCase();
    if (FREE_MAIL.has(d)) add("contact", field, "fix", "Use an address on the brand's own domain, not a free or personal inbox.");
    else if (site && d !== site && !d.endsWith(`.${site}`)) add("contact", field, "fix", `Not on ${site}. Check it's the brand's own address.`);
  }
  need("contact", "Contact email", b.contactEmail, "Every profile asks for one. Use a shared address on the brand's domain.");
  if (b.phone) {
    const digits = b.phone.replace(/[^\d]/g, "");
    if (!b.phone.trim().startsWith("+")) add("contact", "Phone", "fix", "Write it in international format, e.g. +44 20 1234 5678.");
    else if (digits.length < 8 || digits.length > 15) add("contact", "Phone", "fix", "Doesn't look like a complete phone number.");
  }
  if (!b.address && !b.hqLocation) add("contact", "Address", "fill", "Listings compare name, address and phone across the internet. Add the address once here.");
  if (b.contactUrl && !b.contactUrl.startsWith("https://")) add("contact", "Contact page", "fix", "Use the https:// address.");

  /* --------------------------------------------------------------- people */
  for (const p of b.people) {
    if (!p.role.trim()) add("people", p.name || "Unnamed person", "fill", "Add their exact job title, as on LinkedIn.");
  }

  /* ---------------------------------------------------------------- proof */
  for (const point of b.proofPoints) {
    if (VAGUE.test(point) && !/\d/.test(point)) {
      add("proof", "Proof point", "fix", `"${point.slice(0, 60)}" is a claim, not proof. Add the number, name or source behind it.`);
    }
  }
  for (const t of b.testimonials) {
    if (!t.source.trim()) add("proof", "Testimonial", "fill", "Give every quote its person's name and company. Unattributed quotes read as made up.");
  }

  /* --------------------------------------------------------------- visual */
  if (!b.logoUrl) add("visual", "Primary logo", "fill", "The file every profile and listing uses.");
  if (!b.logoIconUrl) add("visual", "Icon / mark", "fill", "Profile pictures use the icon, so it looks the same on every platform.");
  if (b.palette.length === 0) add("visual", "Palette", "fill", "Add the brand colours with their hex codes.");

  /* ---------------------------------------------------------------- voice */
  if (need("voice", "Boilerplate", b.boilerplate, "The standing paragraph press and long bios copy.")) {
    if (!b.boilerplate!.trim().startsWith(b.name)) add("voice", "Boilerplate", "fix", `Start it with the brand name exactly: "${b.name}".`);
  }

  /* ---------------------------------------------------------------- links */
  for (const l of b.links) {
    if (!l.url.startsWith("https://")) add("links", l.label || l.url, "fix", "Use the https:// address.");
  }

  /* ------------------------------------------------------ across channels */
  const main = mainHandle(channels);
  if (main) {
    const off = channels.filter((c) => {
      const h = normalHandle(c.handle);
      return h !== null && h !== main;
    });
    if (off.length > 0) {
      const list = off.map((c) => `${c.handle} (${c.platform})`).join(", ");
      add("basics", "Handles", "fix", `Most channels are @${main}, but ${list} ${off.length === 1 ? "differs" : "differ"}. Use one handle everywhere, or note why a platform can't.`);
    }
  }

  return out;
}

/**
 * The exact values to paste into a profile or registration form, in the
 * order most forms ask for them. Empty fields are left out rather than
 * guessed.
 */
export function profileCopy(b: Brand, channels: Channel[]) {
  const handle = mainHandle(channels);
  return [
    ["Name", b.name],
    ["Legal name", b.legalName],
    ["Handle", handle ? `@${handle}` : null],
    ["Category", b.industry],
    ["Short bio", b.tagline],
    ["About", b.description],
    ["Website", b.website],
    ["Email", b.contactEmail],
    ["Support email", b.supportEmail],
    ["Phone", b.phone],
    ["Address", b.address],
    ["Location", b.hqLocation],
    ["Opening hours", b.openingHours],
    ["Founded", b.foundedYear?.toString() ?? null],
    ["Contact page", b.contactUrl],
    ["Call to action", b.ctaText],
  ].filter((r): r is [string, string] => !!r[1]?.trim()).map(([label, value]) => ({ label, value: value.trim() }));
}
