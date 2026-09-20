import { SignJWT } from "jose";
import { apiFetch, NotConnectedError, type Platform } from "../types";

/** Ghost Admin tokens are short-lived JWTs signed with the hex half of the key. */
async function adminToken(key: string) {
  const [id, secret] = key.split(":");
  if (!id || !secret) throw new Error("Ghost admin key must look like id:secret.");
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", kid: id })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("/admin/")
    .sign(Buffer.from(secret, "hex"));
}

export const ghost: Platform = {
  id: "ghost",
  name: "Ghost",
  color: "#15171A",
  category: "blog",
  blurb: "Posts that publish to the web and email your members in one send.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: 20,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "siteUrl", label: "Ghost site URL", type: "text", required: true, placeholder: "https://blog.yourbrand.com" },
    { key: "title", label: "Post title", type: "text", required: true },
    { key: "status", label: "Status", type: "select", defaultValue: "published",
      choices: [{ value: "published", label: "Publish" }, { value: "draft", label: "Draft" }] },
    { key: "excerpt", label: "Custom excerpt", type: "textarea" },
    { key: "tags", label: "Tags", type: "text", placeholder: "Growth, Product" },
    { key: "emailSegment", label: "Email on publish", type: "select", defaultValue: "",
      choices: [
        { value: "", label: "Web only" },
        { value: "all", label: "All members" },
        { value: "status:free", label: "Free members" },
        { value: "status:-free", label: "Paid members" },
      ] },
    { key: "featureImage", label: "Feature image URL", type: "text" },
  ],
  validate: ({ options }) => (
    String(options.title ?? "").trim() ? [] : [{ level: "error" as const, message: "Ghost posts need a title." }]
  ),
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.siteUrl ?? "")}/ghost` },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://ghost.org/docs/admin-api/#posts",
    envKeys: [],
    requiresAppReview: false,
    notes: "Ghost admin → Settings → Integrations → Add custom integration. Paste the Admin API key (id:secret) as the access token.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("Ghost", "missing admin API key");
    const raw = String(ctx.options.siteUrl ?? "");
    if (!raw) throw new Error("Ghost needs the site URL.");
    const base = (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
    const token = await adminToken(key);
    const segment = String(ctx.options.emailSegment ?? "");

    const html = [
      ctx.body,
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<figure><img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}"/></figure>`),
    ].join("\n");

    const query = new URLSearchParams({ source: "html" });
    if (segment) query.set("newsletter", "default-newsletter");

    const res = await apiFetch(`${base}/ghost/api/admin/posts/?${query}`, {
      label: "Ghost post",
      method: "POST",
      headers: { Authorization: `Ghost ${token}`, "Content-Type": "application/json", "Accept-Version": "v5.0" },
      body: JSON.stringify({
        posts: [{
          title: String(ctx.options.title ?? ctx.post.title ?? ""),
          html,
          status: String(ctx.options.status ?? "published"),
          custom_excerpt: ctx.options.excerpt ? String(ctx.options.excerpt).slice(0, 300) : undefined,
          feature_image: ctx.options.featureImage
            ? String(ctx.options.featureImage)
            : ctx.media.find((m) => m.kind === "image") ? ctx.publicUrl(ctx.media.find((m) => m.kind === "image")!) : undefined,
          tags: String(ctx.options.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((name) => ({ name })),
          ...(segment ? { email_segment: segment } : {}),
        }],
      }),
    });
    const post = ((res.posts as Record<string, unknown>[]) ?? [])[0] ?? {};
    return { externalId: String(post.id ?? ""), externalUrl: String(post.url ?? "") };
  },
};
