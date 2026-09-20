import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://chatapi.viber.com/pa";

export const viber: Platform = {
  id: "viber",
  name: "Viber",
  color: "#7360F2",
  category: "messaging",
  blurb: "Business messages to subscribers — strong in Eastern Europe and South-East Asia.",
  constraints: {
    textMax: 1000,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "receivers", label: "Subscriber IDs", type: "textarea", required: true, help: "Viber user IDs from your subscribe webhook, comma separated. Max 300 per send." },
    { key: "senderName", label: "Sender name", type: "text", required: true, placeholder: "Your Brand" },
    { key: "buttonText", label: "Button label", type: "text", placeholder: "Learn more" },
    { key: "buttonUrl", label: "Button link", type: "text", placeholder: "https://…" },
  ],
  validate: ({ options }) => {
    const n = String(options.receivers ?? "").split(/[\s,;]+/).filter(Boolean).length;
    if (!n) return [{ level: "error" as const, message: "Add at least one subscriber ID." }];
    return n > 300 ? [{ level: "error" as const, message: "Viber allows 300 receivers per broadcast." }] : [];
  },
  manualSteps: (ctx) => [
    { label: "Open Viber Business Messages" },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.viber.com/docs/api/rest-bot-api/#broadcast-message",
    envKeys: [],
    requiresAppReview: false,
    notes: "Create a Viber bot or Public Account and paste its auth token. Only users who subscribed to the account can be messaged.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Viber", "missing auth token");
    const receivers = String(ctx.options.receivers ?? "").split(/[\s,;]+/).filter(Boolean).slice(0, 300);
    const m = ctx.media[0];

    const res = await apiFetch(`${API}/broadcast_message`, {
      label: "Viber broadcast",
      method: "POST",
      headers: { "X-Viber-Auth-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast_list: receivers,
        sender: { name: String(ctx.options.senderName ?? ctx.channel.displayName ?? ctx.channel.handle) },
        ...(m && m.kind === "image"
          ? { type: "picture", text: ctx.body.slice(0, 768), media: ctx.publicUrl(m) }
          : m && m.kind === "video"
            ? { type: "video", media: ctx.publicUrl(m), size: m.size || undefined }
            : { type: "text", text: ctx.body.slice(0, 1000) }),
        ...(ctx.options.buttonText && ctx.options.buttonUrl
          ? { keyboard: { Type: "keyboard", Buttons: [{ Columns: 6, Rows: 1, ActionType: "open-url", ActionBody: String(ctx.options.buttonUrl), Text: String(ctx.options.buttonText) }] } }
          : {}),
      }),
    });
    if (Number(res.status) !== 0) throw new Error(`Viber rejected the broadcast: ${String(res.status_message ?? res.status)}`);
    return { externalId: String(res.message_token ?? ""), note: `Broadcast to ${receivers.length} subscriber${receivers.length === 1 ? "" : "s"}.` };
  },
};
