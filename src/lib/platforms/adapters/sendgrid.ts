import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.sendgrid.com/v3";

export const sendgrid: Platform = {
  id: "sendgrid",
  name: "SendGrid",
  color: "#1A82E2",
  category: "email",
  blurb: "Marketing single sends to contact lists at scale.",
  constraints: {
    textMax: 200000, mediaMin: 0, mediaMax: 10, allowedMedia: ["image"], supportsLinks: true, hashtagsUseful: false,
  },
  optionFields: [
    { key: "listIds", label: "Contact list IDs", type: "text", required: true, placeholder: "uuid, uuid" },
    { key: "subject", label: "Subject line", type: "text", required: true },
    { key: "senderId", label: "Sender ID", type: "number", required: true, help: "Marketing → Senders; the numeric id." },
    { key: "suppressionGroupId", label: "Unsubscribe group ID", type: "number", required: true },
    { key: "sendNow", label: "Schedule immediately", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => {
    const issues = [];
    for (const [k, label] of [["listIds", "Contact list IDs"], ["subject", "Subject line"], ["senderId", "Sender ID"], ["suppressionGroupId", "Unsubscribe group ID"]] as const) {
      if (!String(options[k] ?? "").trim()) issues.push({ level: "error" as const, message: `${label} is required.` });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open SendGrid → Marketing → Single Sends" },
    { label: "Subject", copy: String(ctx.options.subject ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://www.twilio.com/docs/sendgrid/api-reference/single-sends/create-single-send",
    envKeys: [],
    requiresAppReview: false,
    notes: "Settings → API Keys → Create with Marketing full access. Paste the key (SG.…) as the access token.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("SendGrid", "missing API key");
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}" style="max-width:100%"/>`),
      "<p><unsubscribe>Unsubscribe</unsubscribe></p>",
    ].join("\n");

    const res = await apiFetch(`${API}/marketing/singlesends`, {
      label: "SendGrid single send",
      method: "POST",
      headers,
      body: JSON.stringify({
        name: ctx.post.title || String(ctx.options.subject ?? ""),
        send_to: { list_ids: String(ctx.options.listIds ?? "").split(",").map((s) => s.trim()).filter(Boolean) },
        email_config: {
          subject: String(ctx.options.subject ?? ""),
          html_content: html,
          sender_id: Number(ctx.options.senderId),
          suppression_group_id: Number(ctx.options.suppressionGroupId),
        },
        ...(ctx.options.sendNow ? { send_at: "now" } : {}),
      }),
    });
    return { externalId: String(res.id ?? ""), note: ctx.options.sendNow ? "Single send scheduled to go now." : "Single send created as a draft." };
  },
};
