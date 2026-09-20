import { apiFetch, NotConnectedError, type Platform } from "../types";

export const devto: Platform = {
  id: "devto",
  name: "DEV.to",
  color: "#0A0A0A",
  category: "blog",
  blurb: "Technical articles in front of a developer audience — canonical URL keeps the SEO at home.",
  constraints: {
    textMax: 100000,
    mediaMin: 0,
    mediaMax: 0,
    allowedMedia: [],
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "published", label: "Publish immediately", type: "boolean", defaultValue: true },
    { key: "tags", label: "Tags", type: "text", placeholder: "webdev, nextjs, saas", help: "Max 4, lowercase, no spaces." },
    { key: "canonicalUrl", label: "Canonical URL", type: "text", placeholder: "https://yourbrand.com/blog/…", help: "Point this at your own post so you keep the ranking." },
    { key: "series", label: "Series name", type: "text" },
  ],
  validate: ({ options, media }) => {
    const issues = [];
    if (!String(options.title ?? "").trim()) issues.push({ level: "error" as const, message: "DEV.to articles need a title." });
    const tags = String(options.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length > 4) issues.push({ level: "error" as const, message: "DEV.to allows at most 4 tags." });
    if (media.length) issues.push({ level: "warn" as const, message: "Embed images as Markdown URLs — DEV.to has no upload endpoint." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open dev.to/new" },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Markdown body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.forem.com/api/v1#tag/articles/operation/createArticle",
    envKeys: [],
    requiresAppReview: false,
    notes: "Settings → Extensions → DEV Community API Keys. Paste the key as the access token. Works immediately.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("DEV.to", "missing API key");
    const body = ctx.media.length
      ? [ctx.body, ...ctx.media.filter((m) => m.kind === "image").map((m) => `![${m.altText ?? ""}](${ctx.publicUrl(m)})`)].join("\n\n")
      : ctx.body;

    const res = await apiFetch("https://dev.to/api/articles", {
      label: "DEV.to article",
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        article: {
          title: String(ctx.options.title ?? ctx.post.title ?? ""),
          body_markdown: body,
          published: ctx.options.published !== false,
          tags: String(ctx.options.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 4),
          canonical_url: ctx.options.canonicalUrl ? String(ctx.options.canonicalUrl) : undefined,
          series: ctx.options.series ? String(ctx.options.series) : undefined,
        },
      }),
    });
    return { externalId: String(res.id ?? ""), externalUrl: String(res.url ?? "") };
  },
};
