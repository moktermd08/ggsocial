import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";

export const klaviyo: Platform = {
  id: "klaviyo",
  name: "Klaviyo",
  color: "#232426",
  category: "email",
  blurb: "Ecommerce email and SMS with behavioural segments — the highest revenue-per-send here.",
  constraints: {
    textMax: 200000, mediaMin: 0, mediaMax: 10, allowedMedia: ["image"], supportsLinks: true, hashtagsUseful: false,
  },
  optionFields: [
    { key: "listId", label: "List / segment ID", type: "text", required: true },
    { key: "audienceType", label: "Audience type", type: "select", defaultValue: "list",
      choices: [{ value: "list", label: "List" }, { value: "segment", label: "Segment" }] },
    { key: "subject", label: "Subject line", type: "text", required: true },
    { key: "previewText", label: "Preview text", type: "text" },
    { key: "fromEmail", label: "From email", type: "text", required: true },
    { key: "fromLabel", label: "From name", type: "text", required: true },
  ],
  validate: ({ options }) => {
    const issues = [];
    for (const [k, label] of [["listId", "List / segment ID"], ["subject", "Subject line"], ["fromEmail", "From email"], ["fromLabel", "From name"]] as const) {
      if (!String(options[k] ?? "").trim()) issues.push({ level: "error" as const, message: `${label} is required.` });
    }
    issues.push({ level: "warn" as const, message: "ggsocial creates the campaign as a draft — send it from Klaviyo after a final check." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open Klaviyo → Campaigns" },
    { label: "Subject", copy: String(ctx.options.subject ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.klaviyo.com/en/reference/create_campaign",
    envKeys: [],
    requiresAppReview: false,
    notes: "Settings → API keys → Create private key with Campaigns write access. Paste it as the access token.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("Klaviyo", "missing private API key");
    const headers = {
      Authorization: `Klaviyo-API-Key ${key}`,
      "Content-Type": "application/json",
      accept: "application/json",
      revision: REVISION,
    };
    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}" style="max-width:100%"/>`),
    ].join("\n");

    const res = await apiFetch(`${API}/campaigns`, {
      label: "Klaviyo campaign",
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          type: "campaign",
          attributes: {
            name: ctx.post.title || String(ctx.options.subject ?? ""),
            audiences: { included: [String(ctx.options.listId)] },
            send_strategy: { method: "static", options_static: { datetime: new Date(Date.now() + 3600_000).toISOString() } },
            "campaign-messages": {
              data: [{
                type: "campaign-message",
                attributes: {
                  definition: {
                    channel: "email",
                    label: String(ctx.options.subject ?? ""),
                    content: {
                      subject: String(ctx.options.subject ?? ""),
                      preview_text: ctx.options.previewText ? String(ctx.options.previewText) : undefined,
                      from_email: String(ctx.options.fromEmail ?? ""),
                      from_label: String(ctx.options.fromLabel ?? ""),
                    },
                  },
                },
              }],
            },
          },
        },
      }),
    });
    const data = (res.data as Record<string, unknown>) ?? {};
    return {
      externalId: String(data.id ?? ""),
      note: `Draft campaign created. Paste the body into the template in Klaviyo (${html.length} characters prepared) and send.`,
    };
  },
};
