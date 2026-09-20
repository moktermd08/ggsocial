import { apiFetch, NotConnectedError, type Platform } from "../types";

function site(ctx: { channel: { settings: unknown }; options: Record<string, unknown> }) {
  const s = (ctx.channel.settings ?? {}) as Record<string, unknown>;
  const raw = String(ctx.options.siteUrl ?? s.siteUrl ?? "");
  if (!raw) throw new Error("WordPress needs the site URL.");
  return (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
}

export const wordpress: Platform = {
  id: "wordpress",
  name: "WordPress",
  color: "#21759B",
  category: "blog",
  blurb: "Full articles on your own domain — the only channel where the traffic is yours to keep.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: 20,
    allowedMedia: ["image", "video", "document"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "siteUrl", label: "Site URL", type: "text", required: true, placeholder: "https://yourbrand.com" },
    { key: "title", label: "Post title", type: "text", required: true },
    { key: "status", label: "Status", type: "select", defaultValue: "publish",
      choices: [{ value: "publish", label: "Publish" }, { value: "draft", label: "Draft" }, { value: "pending", label: "Pending review" }] },
    { key: "slug", label: "Slug", type: "text", placeholder: "best-social-scheduler" },
    { key: "excerpt", label: "Excerpt / meta description", type: "textarea" },
    { key: "categories", label: "Category IDs", type: "text", placeholder: "3, 7" },
    { key: "tags", label: "Tag IDs", type: "text", placeholder: "12, 18" },
    { key: "format", label: "Body format", type: "select", defaultValue: "html",
      choices: [{ value: "html", label: "HTML" }, { value: "text", label: "Plain text (wrapped in paragraphs)" }] },
  ],
  validate: ({ options }) => (
    String(options.title ?? "").trim() ? [] : [{ level: "error" as const, message: "WordPress posts need a title." }]
  ),
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.siteUrl ?? "")}/wp-admin` },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "Application password",
    docsUrl: "https://developer.wordpress.org/rest-api/reference/posts/#create-a-post",
    envKeys: [],
    requiresAppReview: false,
    notes: "Users → Profile → Application Passwords. Paste the WordPress username as the account ID and the generated application password as the access token.",
  },
  credentialFields: [
    {
      key: "username",
      label: "WordPress username",
      required: true
    }
  ],
  publish: async (ctx) => {
    const password = ctx.credentials?.accessToken;
    const username = ctx.credentials?.username ?? ctx.channel.externalId;
    if (!password || !username) throw new NotConnectedError("WordPress", "missing username or application password");
    const base = site(ctx);
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const ids = (raw: unknown) => String(raw ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);

    const html = String(ctx.options.format ?? "html") === "html"
      ? ctx.body
      : ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");
    const withMedia = [html, ...ctx.media.filter((m) => m.kind === "image").map((m) => `<figure><img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}"/></figure>`)].join("\n");

    const res = await apiFetch(`${base}/wp-json/wp/v2/posts`, {
      label: "WordPress post",
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: String(ctx.options.title ?? ctx.post.title ?? ""),
        content: withMedia,
        status: String(ctx.options.status ?? "publish"),
        slug: ctx.options.slug ? String(ctx.options.slug) : undefined,
        excerpt: ctx.options.excerpt ? String(ctx.options.excerpt) : undefined,
        categories: ids(ctx.options.categories).length ? ids(ctx.options.categories) : undefined,
        tags: ids(ctx.options.tags).length ? ids(ctx.options.tags) : undefined,
      }),
    });
    return { externalId: String(res.id ?? ""), externalUrl: String(res.link ?? "") };
  },
};
