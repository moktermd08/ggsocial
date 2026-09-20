import { apiFetch, NotConnectedError, type Platform } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Recipients are stored per target as a comma/newline separated list of E.164 numbers. */
function recipients(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.replace(/[^\d+]/g, ""))
    .filter((s) => s.length >= 8);
}

export const whatsapp: Platform = {
  id: "whatsapp",
  name: "WhatsApp Business",
  color: "#25D366",
  category: "messaging",
  blurb: "Cloud API sends to opted-in contacts — the highest conversion rate of any channel here.",
  constraints: {
    textMax: 4096,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image", "video", "document"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "recipients", label: "Recipients", type: "textarea", required: true, placeholder: "+8801700000000, +8801800000000", help: "E.164 numbers that have opted in. Outside the 24-hour window only template messages are delivered." },
    { key: "sendAs", label: "Message type", type: "select", defaultValue: "template",
      choices: [
        { value: "template", label: "Approved template (works any time)" },
        { value: "text", label: "Free-form text (24h service window only)" },
      ] },
    { key: "templateName", label: "Template name", type: "text", placeholder: "monthly_offer" },
    { key: "templateLang", label: "Template language", type: "text", defaultValue: "en_US" },
    { key: "templateParams", label: "Template variables", type: "text", placeholder: "Mokter, 20%", help: "Comma separated, in {{1}} {{2}} order." },
  ],
  validate: ({ options }) => {
    const issues = [];
    const list = recipients(options.recipients);
    if (!list.length) issues.push({ level: "error" as const, message: "Add at least one E.164 recipient number." });
    if (options.sendAs === "template" && !String(options.templateName ?? "").trim()) {
      issues.push({ level: "error" as const, message: "Template sends need an approved template name." });
    }
    if (options.sendAs === "text") {
      issues.push({ level: "warn" as const, message: "Free-form text only reaches contacts who messaged you in the last 24 hours." });
    }
    if (list.length > 100) {
      issues.push({ level: "warn" as const, message: `${list.length} recipients — sends run sequentially and may take a while.` });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open WhatsApp Business" },
    { label: "Recipients", copy: String(ctx.options.recipients ?? "") },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "System user access token",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages",
    envKeys: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TOKEN"],
    requiresAppReview: false,
    notes: "Add WhatsApp to a Meta app, verify the business, then paste the permanent system-user token as the access token and the Phone Number ID as the account ID. Templates must be approved before they will send.",
  },
  credentialFields: [
    {
      key: "phoneNumberId",
      label: "Phone Number ID",
      required: true,
      placeholder: "1234567890",
      help: "WhatsApp Manager → API Setup."
    }
  ],
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    const phoneId = ctx.credentials?.phoneNumberId ?? ctx.channel.externalId;
    if (!token) throw new NotConnectedError("WhatsApp Business", "missing access token");
    if (!phoneId) throw new NotConnectedError("WhatsApp Business", "missing Phone Number ID");

    const list = recipients(ctx.options.recipients);
    const asTemplate = String(ctx.options.sendAs ?? "template") === "template";
    const params = String(ctx.options.templateParams ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const m = ctx.media[0];

    const sent: string[] = [];
    const failed: string[] = [];
    for (const to of list) {
      const payload = asTemplate
        ? {
            messaging_product: "whatsapp", to, type: "template",
            template: {
              name: String(ctx.options.templateName ?? ""),
              language: { code: String(ctx.options.templateLang ?? "en_US") },
              components: [
                ...(m ? [{ type: "header", parameters: [{ type: m.kind === "video" ? "video" : m.kind === "document" ? "document" : "image", [m.kind === "video" ? "video" : m.kind === "document" ? "document" : "image"]: { link: ctx.publicUrl(m) } }] }] : []),
                ...(params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : []),
              ],
            },
          }
        : m
          ? { messaging_product: "whatsapp", to, type: m.kind === "video" ? "video" : m.kind === "document" ? "document" : "image",
              [m.kind === "video" ? "video" : m.kind === "document" ? "document" : "image"]: { link: ctx.publicUrl(m), caption: ctx.body.slice(0, 1024) } }
          : { messaging_product: "whatsapp", to, type: "text", text: { body: ctx.body, preview_url: true } };

      try {
        const res = await apiFetch(`${GRAPH}/${phoneId}/messages`, {
          label: "WhatsApp send",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const msgs = (res.messages as { id?: string }[] | undefined) ?? [];
        sent.push(msgs[0]?.id ?? to);
      } catch {
        failed.push(to);
      }
    }

    if (!sent.length) throw new Error(`WhatsApp delivered to none of the ${list.length} recipients.`);
    return {
      externalId: sent[0],
      note: `Delivered to ${sent.length}/${list.length} recipients${failed.length ? ` — failed: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}` : ""}.`,
    };
  },
};
