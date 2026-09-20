import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.resend.com";

export const resend: Platform = {
  id: "resend",
  name: "Resend",
  color: "#000000",
  category: "email",
  blurb: "Developer-friendly broadcasts and transactional sends from your own domain.",
  constraints: {
    textMax: 200000, mediaMin: 0, mediaMax: 10, allowedMedia: ["image"], supportsLinks: true, hashtagsUseful: false,
  },
  optionFields: [
    { key: "mode", label: "Send as", type: "select", defaultValue: "broadcast",
      choices: [{ value: "broadcast", label: "Broadcast to an audience" }, { value: "direct", label: "Direct email to a list of addresses" }] },
    { key: "audienceId", label: "Audience ID", type: "text", help: "Broadcast mode." },
    { key: "to", label: "Recipients", type: "textarea", placeholder: "a@example.com, b@example.com", help: "Direct mode, max 50 per send." },
    { key: "subject", label: "Subject line", type: "text", required: true },
    { key: "from", label: "From", type: "text", required: true, placeholder: "Your Brand <hello@yourbrand.com>" },
    { key: "sendNow", label: "Send immediately", type: "boolean", defaultValue: false, help: "Broadcast mode only." },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.subject ?? "").trim()) issues.push({ level: "error" as const, message: "Subject line is required." });
    if (!String(options.from ?? "").trim()) issues.push({ level: "error" as const, message: "From address is required." });
    if (options.mode === "broadcast" && !String(options.audienceId ?? "").trim()) {
      issues.push({ level: "error" as const, message: "Broadcasts need an audience ID." });
    }
    if (options.mode === "direct" && !String(options.to ?? "").trim()) {
      issues.push({ level: "error" as const, message: "Add at least one recipient." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open resend.com/broadcasts" },
    { label: "Subject", copy: String(ctx.options.subject ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://resend.com/docs/api-reference/broadcasts/create-broadcast",
    envKeys: [],
    requiresAppReview: false,
    notes: "API Keys → Create. Paste the key (re_…) as the access token. The sending domain must be verified first.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("Resend", "missing API key");
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}" style="max-width:100%"/>`),
    ].join("\n");

    if (String(ctx.options.mode ?? "broadcast") === "direct") {
      const to = String(ctx.options.to ?? "").split(/[\s,;]+/).filter(Boolean).slice(0, 50);
      const res = await apiFetch(`${API}/emails`, {
        label: "Resend email", method: "POST", headers,
        body: JSON.stringify({ from: String(ctx.options.from), to, subject: String(ctx.options.subject), html, text: ctx.body }),
      });
      return { externalId: String(res.id ?? ""), note: `Sent to ${to.length} recipient${to.length === 1 ? "" : "s"}.` };
    }

    const created = await apiFetch(`${API}/broadcasts`, {
      label: "Resend broadcast", method: "POST", headers,
      body: JSON.stringify({
        audience_id: String(ctx.options.audienceId),
        from: String(ctx.options.from),
        subject: String(ctx.options.subject),
        html, text: ctx.body,
      }),
    });
    const id = String(created.id ?? "");
    if (ctx.options.sendNow && id) {
      await apiFetch(`${API}/broadcasts/${id}/send`, { label: "Resend broadcast send", method: "POST", headers, body: JSON.stringify({}) });
    }
    return { externalId: id, note: ctx.options.sendNow ? "Broadcast sent." : "Broadcast created as a draft." };
  },
};
