import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.beehiiv.com/v2";

export const beehiiv: Platform = {
  id: "beehiiv",
  name: "beehiiv",
  color: "#FFC107",
  category: "email",
  blurb: "Newsletter issues that hit the inbox and a public web page — owned audience, no algorithm.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "publicationId", label: "Publication ID", type: "text", required: true, placeholder: "pub_xxxxxxxx" },
    { key: "title", label: "Subject / title", type: "text", required: true },
    { key: "subtitle", label: "Preview text", type: "text", help: "The line shown next to the subject in the inbox — worth as much as the subject." },
    { key: "status", label: "Action", type: "select", defaultValue: "draft",
      choices: [{ value: "draft", label: "Create draft" }, { value: "confirmed", label: "Schedule / send" }] },
    { key: "audience", label: "Audience", type: "select", defaultValue: "free",
      choices: [{ value: "free", label: "Free subscribers" }, { value: "premium", label: "Paid subscribers" }, { value: "both", label: "Everyone" }] },
  ],
  validate: ({ options }) => (
    String(options.title ?? "").trim() ? [] : [{ level: "error" as const, message: "Give the issue a subject line." }]
  ),
  manualSteps: (ctx) => [
    { label: "Open app.beehiiv.com" },
    { label: "Subject", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.beehiiv.com/api-reference/posts/create",
    envKeys: [],
    requiresAppReview: false,
    notes: "Settings → API. Paste the key as the access token. Post creation requires a Scale plan; on lower plans the channel still works in manual mode.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("beehiiv", "missing API key");
    const pub = String(ctx.options.publicationId ?? ctx.channel.externalId ?? "");
    if (!pub) throw new Error("beehiiv needs a publication ID.");

    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}"/>`),
    ].join("\n");

    const res = await apiFetch(`${API}/publications/${pub}/posts`, {
      label: "beehiiv post",
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: String(ctx.options.title ?? ctx.post.title ?? ""),
        subtitle: ctx.options.subtitle ? String(ctx.options.subtitle) : undefined,
        body_content: html,
        status: String(ctx.options.status ?? "draft"),
        audience: String(ctx.options.audience ?? "free"),
        content_tags: [],
      }),
    });
    const data = (res.data as Record<string, unknown>) ?? {};
    return { externalId: String(data.id ?? ""), externalUrl: String(data.web_url ?? "") };
  },
};
