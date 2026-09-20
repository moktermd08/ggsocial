import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.kit.com/v4";

export const convertkit: Platform = {
  id: "convertkit",
  name: "Kit (ConvertKit)",
  color: "#FB6970",
  category: "email",
  blurb: "Creator-first broadcasts and sequences — the workhorse for newsletter-led funnels.",
  constraints: {
    textMax: 200000, mediaMin: 0, mediaMax: 10, allowedMedia: ["image"], supportsLinks: true, hashtagsUseful: false,
  },
  optionFields: [
    { key: "subject", label: "Subject line", type: "text", required: true },
    { key: "previewText", label: "Preview text", type: "text" },
    { key: "publicUrl", label: "Publish publicly", type: "boolean", defaultValue: true, help: "Also creates a public web version — free SEO for every issue." },
    { key: "sendNow", label: "Send immediately", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => (
    String(options.subject ?? "").trim() ? [] : [{ level: "error" as const, message: "Subject line is required." }]
  ),
  manualSteps: (ctx) => [
    { label: "Open Kit → Broadcasts" },
    { label: "Subject", copy: String(ctx.options.subject ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.kit.com/v4#create-a-broadcast",
    envKeys: [],
    requiresAppReview: false,
    notes: "Settings → Advanced → API → V4 API key. Paste it as the access token.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("Kit", "missing V4 API key");
    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}" style="max-width:100%"/>`),
    ].join("\n");

    const res = await apiFetch(`${API}/broadcasts`, {
      label: "Kit broadcast",
      method: "POST",
      headers: { "X-Kit-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: String(ctx.options.subject ?? ""),
        preview_text: ctx.options.previewText ? String(ctx.options.previewText) : undefined,
        content: html,
        public: ctx.options.publicUrl !== false,
        ...(ctx.options.sendNow ? { send_at: new Date().toISOString() } : {}),
      }),
    });
    const b = (res.broadcast as Record<string, unknown>) ?? {};
    return {
      externalId: String(b.id ?? ""),
      note: ctx.options.sendNow ? "Broadcast queued for immediate send." : "Broadcast saved as a draft in Kit.",
    };
  },
};
