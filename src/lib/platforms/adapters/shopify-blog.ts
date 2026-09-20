import { apiFetch, NotConnectedError, type Platform } from "../types";

const VERSION = "2025-01";

export const shopifyBlog: Platform = {
  id: "shopify_blog",
  name: "Shopify Blog",
  color: "#95BF47",
  category: "blog",
  blurb: "Articles on your store's blog — SEO traffic that lands one click from checkout.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "shop", label: "Shop domain", type: "text", required: true, placeholder: "yourstore.myshopify.com" },
    { key: "blogId", label: "Blog ID", type: "text", required: true, help: "Admin → Content → Blog posts; the id is in the URL." },
    { key: "title", label: "Article title", type: "text", required: true },
    { key: "author", label: "Author", type: "text" },
    { key: "tags", label: "Tags", type: "text", placeholder: "guides, skincare" },
    { key: "published", label: "Publish immediately", type: "boolean", defaultValue: true },
    { key: "summary", label: "Excerpt", type: "textarea" },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.shop ?? "").trim()) issues.push({ level: "error" as const, message: "Set the .myshopify.com domain." });
    if (!String(options.title ?? "").trim()) issues.push({ level: "error" as const, message: "Articles need a title." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open Shopify admin → Content → Blog posts" },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://shopify.dev/docs/api/admin-rest/latest/resources/article",
    envKeys: [],
    requiresAppReview: false,
    notes: "Admin → Settings → Apps → Develop apps → Create an app with write_content scope. Paste the Admin API access token (shpat_…) as the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Shopify Blog", "missing Admin API access token");
    const shop = String(ctx.options.shop ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const blogId = String(ctx.options.blogId);
    const image = ctx.media.find((m) => m.kind === "image");
    const html = ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");

    const res = await apiFetch(`https://${shop}/admin/api/${VERSION}/blogs/${blogId}/articles.json`, {
      label: "Shopify article",
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        article: {
          title: String(ctx.options.title ?? ctx.post.title ?? ""),
          body_html: html,
          author: ctx.options.author ? String(ctx.options.author) : undefined,
          tags: String(ctx.options.tags ?? ""),
          summary_html: ctx.options.summary ? `<p>${String(ctx.options.summary)}</p>` : undefined,
          published: ctx.options.published !== false,
          ...(image ? { image: { src: ctx.publicUrl(image), alt: image.altText ?? "" } } : {}),
        },
      }),
    });
    const article = (res.article as Record<string, unknown>) ?? {};
    return {
      externalId: String(article.id ?? ""),
      externalUrl: article.handle ? `https://${shop}/blogs/news/${String(article.handle)}` : undefined,
    };
  },
};
