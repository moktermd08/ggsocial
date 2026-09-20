import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.brevo.com/v3";

export const brevo: Platform = {
  id: "brevo",
  name: "Brevo",
  color: "#0B996E",
  category: "email",
  blurb: "Email campaigns with a generous free tier — a practical first owned channel.",
  constraints: {
    textMax: 200000, mediaMin: 0, mediaMax: 10, allowedMedia: ["image"], supportsLinks: true, hashtagsUseful: false,
  },
  optionFields: [
    { key: "listIds", label: "List IDs", type: "text", required: true, placeholder: "3, 7" },
    { key: "subject", label: "Subject line", type: "text", required: true },
    { key: "senderName", label: "Sender name", type: "text", required: true },
    { key: "senderEmail", label: "Sender email", type: "text", required: true },
    { key: "sendNow", label: "Send immediately", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.listIds ?? "").trim()) issues.push({ level: "error" as const, message: "Add at least one list ID." });
    if (!String(options.subject ?? "").trim()) issues.push({ level: "error" as const, message: "Subject line is required." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open Brevo → Campaigns" },
    { label: "Subject", copy: String(ctx.options.subject ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.brevo.com/reference/createemailcampaign-1",
    envKeys: [],
    requiresAppReview: false,
    notes: "SMTP & API → API Keys → Generate. Paste the v3 key as the access token.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("Brevo", "missing API key");
    const headers = { "api-key": key, "Content-Type": "application/json", accept: "application/json" };
    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}" style="max-width:100%"/>`),
    ].join("\n");

    const res = await apiFetch(`${API}/emailCampaigns`, {
      label: "Brevo campaign",
      method: "POST",
      headers,
      body: JSON.stringify({
        name: ctx.post.title || String(ctx.options.subject ?? ""),
        subject: String(ctx.options.subject ?? ""),
        sender: { name: String(ctx.options.senderName ?? ""), email: String(ctx.options.senderEmail ?? "") },
        type: "classic",
        htmlContent: html,
        recipients: { listIds: String(ctx.options.listIds ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean) },
        ...(ctx.options.sendNow ? {} : { scheduledAt: undefined }),
      }),
    });
    const id = String(res.id ?? "");
    if (ctx.options.sendNow && id) {
      await apiFetch(`${API}/emailCampaigns/${id}/sendNow`, { label: "Brevo send", method: "POST", headers });
    }
    return { externalId: id, note: ctx.options.sendNow ? "Campaign sent." : "Draft campaign created in Brevo." };
  },
};
