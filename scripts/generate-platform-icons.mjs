/**
 * Regenerates src/lib/platforms/glyphs.ts — the real brand mark for every
 * platform in the roster.
 *
 * Paths come from simple-icons (CC0-1.0, a devDependency). A handful of brands
 * were pulled from later simple-icons releases after trademark requests, so
 * their last published path is vendored below with the version it came from;
 * using a brand's own mark to label a channel that posts to that brand is
 * nominative use, which is what every other scheduler does too.
 *
 * Anything with no authentic mark available is deliberately left out: the
 * renderer falls back to a wordmark tile rather than showing a near-miss logo.
 *
 *   node scripts/generate-platform-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as simpleIcons from "simple-icons";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTERS = path.join(root, "src/lib/platforms/adapters");
const OUT = path.join(root, "src/lib/platforms/glyphs.ts");

/** Marks simple-icons no longer ships. Captured from the listed release. */
const VENDORED = {
  // LinkedIn — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  linkedin: { hex: "0A66C2", path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" },
  // Slack — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  slack: { hex: "4A154B", path: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" },
  // Twilio — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  twilio: { hex: "F22F46", path: "M12 0C5.381-.008.008 5.352 0 11.971V12c0 6.64 5.359 12 12 12 6.64 0 12-5.36 12-12 0-6.641-5.36-12-12-12zm0 20.801c-4.846.015-8.786-3.904-8.801-8.75V12c-.014-4.846 3.904-8.786 8.75-8.801H12c4.847-.014 8.786 3.904 8.801 8.75V12c.015 4.847-3.904 8.786-8.75 8.801H12zm5.44-11.76c0 1.359-1.12 2.479-2.481 2.479-1.366-.007-2.472-1.113-2.479-2.479 0-1.361 1.12-2.481 2.479-2.481 1.361 0 2.481 1.12 2.481 2.481zm0 5.919c0 1.36-1.12 2.48-2.481 2.48-1.367-.008-2.473-1.114-2.479-2.48 0-1.359 1.12-2.479 2.479-2.479 1.361-.001 2.481 1.12 2.481 2.479zm-5.919 0c0 1.36-1.12 2.48-2.479 2.48-1.368-.007-2.475-1.113-2.481-2.48 0-1.359 1.12-2.479 2.481-2.479 1.358-.001 2.479 1.12 2.479 2.479zm0-5.919c0 1.359-1.12 2.479-2.479 2.479-1.367-.007-2.475-1.112-2.481-2.479 0-1.361 1.12-2.481 2.481-2.481 1.358 0 2.479 1.12 2.479 2.481z" },
  // Amazon — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  amazon: { hex: "FF9900", path: "M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726a17.617 17.617 0 01-10.951-.577 17.88 17.88 0 01-5.43-3.35c-.1-.074-.151-.15-.151-.22 0-.047.021-.09.051-.13zm6.565-6.218c0-1.005.247-1.863.743-2.577.495-.71 1.17-1.25 2.04-1.615.796-.335 1.756-.575 2.912-.72.39-.046 1.033-.103 1.92-.174v-.37c0-.93-.105-1.558-.3-1.875-.302-.43-.78-.65-1.44-.65h-.182c-.48.046-.896.196-1.246.46-.35.27-.575.63-.675 1.096-.06.3-.206.465-.435.51l-2.52-.315c-.248-.06-.372-.18-.372-.39 0-.046.007-.09.022-.15.247-1.29.855-2.25 1.82-2.88.976-.616 2.1-.975 3.39-1.05h.54c1.65 0 2.957.434 3.888 1.29.135.15.27.3.405.48.12.165.224.314.283.45.075.134.15.33.195.57.06.254.105.42.135.51.03.104.062.3.076.615.01.313.02.493.02.553v5.28c0 .376.06.72.165 1.036.105.313.21.54.315.674l.51.674c.09.136.136.256.136.36 0 .12-.06.226-.18.314-1.2 1.05-1.86 1.62-1.963 1.71-.165.135-.375.15-.63.045a6.062 6.062 0 01-.526-.496l-.31-.347a9.391 9.391 0 01-.317-.42l-.3-.435c-.81.886-1.603 1.44-2.4 1.665-.494.15-1.093.227-1.83.227-1.11 0-2.04-.343-2.76-1.034-.72-.69-1.08-1.665-1.08-2.94l-.05-.076zm3.753-.438c0 .566.14 1.02.425 1.364.285.34.675.512 1.155.512.045 0 .106-.007.195-.02.09-.016.134-.023.166-.023.614-.16 1.08-.553 1.424-1.178.165-.28.285-.58.36-.91.09-.32.12-.59.135-.8.015-.195.015-.54.015-1.005v-.54c-.84 0-1.484.06-1.92.18-1.275.36-1.92 1.17-1.92 2.43l-.035-.02zm9.162 7.027c.03-.06.075-.11.132-.17.362-.243.714-.41 1.05-.5a8.094 8.094 0 011.612-.24c.14-.012.28 0 .41.03.65.06 1.05.168 1.172.33.063.09.099.228.099.39v.15c0 .51-.149 1.11-.424 1.8-.278.69-.664 1.248-1.156 1.68-.073.06-.14.09-.197.09-.03 0-.06 0-.09-.012-.09-.044-.107-.12-.064-.24.54-1.26.806-2.143.806-2.64 0-.15-.03-.27-.087-.344-.145-.166-.55-.257-1.224-.257-.243 0-.533.016-.87.046-.363.045-.7.09-1 .135-.09 0-.148-.014-.18-.044-.03-.03-.036-.047-.02-.077 0-.017.006-.03.02-.063v-.06z" },
  // SendGrid — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  sendgrid: { hex: "51A9E3", path: "M.8 24h13.6c.88 0 1.6-.72 1.6-1.6v-4.8c0-.88-.72-1.6-1.6-1.6H9.6c-.88 0-1.6-.72-1.6-1.6V9.6C8 8.72 7.28 8 6.4 8H1.6C.72 8 0 8.72 0 9.6v13.6c0 .44.36.8.8.8zM23.2 0H9.6C8.72 0 8 .72 8 1.6v4.8C8 7.28 8.72 8 9.6 8h4.8c.88 0 1.6.72 1.6 1.6v4.8c0 .88.72 1.6 1.6 1.6h4.8c.88 0 1.6-.72 1.6-1.6V.8c0-.44-.36-.8-.8-.8Z" },
  // Microsoft Bing — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  microsoftbing: { hex: "258FFA", path: "M20.176 15.406a6.48 6.48 0 01-1.736 4.414c1.338-1.47.803-3.869-1.003-4.635-.862-.305-2.488-.85-3.367-1.158a1.834 1.834 0 01-.932-.818c-.381-.975-1.163-2.968-1.548-3.948-.095-.285-.31-.625-.265-.938.046-.598.724-1.003 1.276-.754l3.682 1.888c.621.292 1.305.692 1.796 1.172a6.486 6.486 0 012.097 4.777zm-1.44 1.888c-.264-1.194-1.135-1.744-2.216-2.028-1.527.902-4.853 2.878-6.952 4.13-1.103.68-2.13 1.35-2.919 1.242a2.866 2.866 0 01-2.77-2.325c-.012-.048-.008-.03-.001.01a6.4 6.4 0 00.947 2.653 6.498 6.498 0 005.486 3.022c1.908.062 3.536-1.153 5.099-2.096.292-.188.804-.496 1.332-.831l1.423-1.51c.553-.577.764-1.426.571-2.267zm-12.04 2.97c.422 0 .822-.1 1.173-.29.355-.215.964-.579 1.7-1.018L9.57 4.502c0-.99-.497-1.864-1.257-2.382-.08-.059-2.91-1.901-2.99-1.956-.605-.432-1.523.045-1.5.797v14.887l.417 2.36a2.488 2.488 0 002.455 2.056z" },
  // Google My Business — simple-icons v13/v9 (CC0-1.0), retired from later releases.
  googlemybusiness: { hex: "4285F4", path: "M3.273 1.636c-.736 0-1.363.492-1.568 1.16L0 9.272c0 1.664 1.336 3 3 3a3 3 0 003-3c0 1.664 1.336 3 3 3a3 3 0 003-3c0 1.65 1.35 3 3 3 1.664 0 3-1.336 3-3 0 1.664 1.336 3 3 3s3-1.336 3-3l-1.705-6.476a1.646 1.646 0 00-1.568-1.16zm8.729 9.326c-.604 1.063-1.703 1.81-3.002 1.81-1.304 0-2.398-.747-3-1.806-.604 1.06-1.702 1.806-3 1.806-.484 0-.944-.1-1.363-.277v8.232c0 .9.736 1.637 1.636 1.637h17.454c.9 0 1.636-.737 1.636-1.637v-8.232a3.48 3.48 0 01-1.363.277c-1.304 0-2.398-.746-3-1.804-.602 1.058-1.696 1.804-3 1.804-1.299 0-2.394-.75-2.998-1.81zm5.725 3.765c.808 0 1.488.298 2.007.782l-.859.859a1.623 1.623 0 00-1.148-.447c-.98 0-1.772.827-1.772 1.806 0 .98.792 1.807 1.772 1.807.882 0 1.485-.501 1.615-1.191h-1.615v-1.16h2.826c.035.196.054.4.054.613 0 1.714-1.147 2.931-2.88 2.931a3 3 0 010-6z" },
};

/**
 * platform id → simple-icons slug. Only ids whose slug differs from the id,
 * plus sub-channels that legitimately carry the parent brand's mark.
 */
const ALIASES = {
  // Sub-surfaces of a parent brand — same logo, different destination.
  facebook_group: "facebook",
  facebook_marketplace: "facebook",
  instagram_broadcast: "instagram",
  whatsapp_channel: "whatsapp",
  youtube_community: "youtube",
  figma_community: "figma",
  apple_business: "apple",
  amazon_posts: "amazon",
  spotify_podcast: "spotify",
  shopify_blog: "shopify",
  // Named differently in simple-icons than in our roster.
  apple_podcast: "applepodcasts",
  devto: "devdotto",
  product_hunt: "producthunt",
  indie_hackers: "indiehackers",
  weibo: "sinaweibo",
  kakao: "kakaotalk",
  google_business: "googlemybusiness",
  bing_places: "microsoftbing",
  twilio_sms: "twilio",
  // Hacker News has never had a mark of its own — the orange Y is YC's.
  hacker_news: "ycombinator",
  // Our webhook channel is the Zapier-style outbound hook.
  webhook: "zapier",
};

/**
 * Ids we refuse to guess at. simple-icons has no mark for these, and the
 * closest match belongs to a different company (simple-icons' "circle" is
 * circle.com, its "kit" is kit.co — neither is the product we mean here).
 */
const NO_AUTHENTIC_MARK = new Set([
  "circle", "convertkit", "klaviyo", "onesignal", "beehiiv", "restream",
  "skool", "mighty_networks", "capterra", "clutch", "olx", "craigslist",
  "bikroy", "daraz", "betalist", "saashub", "douyin", "sharechat",
]);

function readPlatforms() {
  const found = new Map();
  for (const file of fs.readdirSync(ADAPTERS)) {
    if (!file.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(ADAPTERS, file), "utf8");
    const re = /id:\s*"([a-z0-9_]+)"[\s\S]{0,200}?name:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) if (!found.has(m[1])) found.set(m[1], m[2]);
  }
  return [...found.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id));
}

const bySlug = new Map();
for (const icon of Object.values(simpleIcons)) {
  if (icon && typeof icon === "object" && "slug" in icon) bySlug.set(icon.slug, icon);
}

const platforms = readPlatforms();
const entries = [];
const skipped = [];

for (const { id, name } of platforms) {
  if (NO_AUTHENTIC_MARK.has(id)) { skipped.push(`${id} (${name})`); continue; }
  const slug = ALIASES[id] ?? id.replace(/_/g, "");
  const icon = bySlug.get(slug) ?? VENDORED[slug];
  if (!icon) { skipped.push(`${id} (${name}) — no slug "${slug}"`); continue; }
  entries.push({ id, slug, path: icon.path });
}

const body = entries.map((e) => `  ${/^[a-z][a-z0-9_]*$/.test(e.id) ? e.id : JSON.stringify(e.id)}:\n    "${e.path}",`).join("\n");

fs.writeFileSync(OUT, `// Generated by scripts/generate-platform-icons.mjs — do not edit by hand.
// Brand marks from simple-icons (CC0-1.0); see the script for vendored paths.
// Every path draws on a 24x24 viewBox as a single filled shape.

/** Official brand mark per platform. Missing = render the wordmark fallback. */
export const PLATFORM_GLYPHS: Record<string, string> = {
${body}
};
`);

console.log(`Wrote ${entries.length} marks to ${path.relative(root, OUT)}.`);
console.log(`Wordmark fallback (${skipped.length}): ${skipped.join(", ")}`);
