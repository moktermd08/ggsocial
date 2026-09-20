import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.tumblr.com/v2";

export const tumblr: Platform = {
  id: "tumblr",
  name: "Tumblr",
  color: "#36465D",
  category: "social",
  blurb: "Tagged text, photo and link posts — tags are a real discovery surface here.",
  constraints: {
    textMax: 20000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "blog", label: "Blog identifier", type: "text", required: true, placeholder: "yourblog.tumblr.com" },
    { key: "title", label: "Title", type: "text" },
    { key: "tags", label: "Tags", type: "text", placeholder: "marketing, saas, bangladesh", help: "Comma separated. First 5 carry the most reach." },
    { key: "state", label: "State", type: "select", defaultValue: "published",
      choices: [{ value: "published", label: "Publish" }, { value: "queue", label: "Add to Tumblr queue" }, { value: "draft", label: "Draft" }] },
  ],
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.blog ?? ctx.channel.handle)}` },
    { label: "Body", copy: ctx.body },
    { label: "Tags", copy: String(ctx.options.tags ?? "") },
  ],
  liveSetup: {
    docsUrl: "https://www.tumblr.com/docs/en/api/v2#posting",
    envKeys: ["TUMBLR_CONSUMER_KEY", "TUMBLR_CONSUMER_SECRET"],
    requiresAppReview: false,
    notes: "Register at tumblr.com/oauth/apps, then run the OAuth2 flow and paste the access token. Scope: write.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Tumblr", "missing access token");
    const blog = String(ctx.options.blog ?? ctx.channel.externalId ?? ctx.channel.handle);

    const content: unknown[] = [];
    if (ctx.options.title) content.push({ type: "text", subtype: "heading1", text: String(ctx.options.title) });
    if (ctx.body.trim()) content.push({ type: "text", text: ctx.body });
    for (const m of ctx.media) {
      content.push({
        type: m.kind === "video" ? "video" : "image",
        media: [{ url: ctx.publicUrl(m) }],
        ...(m.altText ? { alt_text: m.altText } : {}),
      });
    }

    const res = await apiFetch(`${API}/blog/${blog}/posts`, {
      label: "Tumblr post",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        state: String(ctx.options.state ?? "published"),
        tags: String(ctx.options.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).join(","),
      }),
    });
    const id = String((res.response as Record<string, unknown>)?.id ?? "");
    return { externalId: id, externalUrl: id ? `https://${blog}/post/${id}` : undefined };
  },
};
