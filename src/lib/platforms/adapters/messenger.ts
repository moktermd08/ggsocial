import { apiFetch, NotConnectedError, type Platform } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

export const messenger: Platform = {
  id: "messenger",
  name: "Messenger",
  color: "#0084FF",
  category: "messaging",
  blurb: "Direct sends to people who already messaged your Page — warm, high-reply leads.",
  constraints: {
    textMax: 2000,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "psids", label: "Recipient PSIDs", type: "textarea", required: true, help: "Page-scoped IDs from your webhook or CRM, comma separated." },
    { key: "tag", label: "Message tag", type: "select", defaultValue: "",
      choices: [
        { value: "", label: "None — 24h window only" },
        { value: "CONFIRMED_EVENT_UPDATE", label: "Confirmed event update" },
        { value: "POST_PURCHASE_UPDATE", label: "Post-purchase update" },
        { value: "ACCOUNT_UPDATE", label: "Account update" },
      ],
      help: "Outside 24 hours only tagged, non-promotional messages are allowed." },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.psids ?? "").trim()) issues.push({ level: "error" as const, message: "Add at least one recipient PSID." });
    if (!options.tag) issues.push({ level: "warn" as const, message: "Without a tag this only delivers inside the 24-hour window." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open the Page inbox" },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.facebook.com/docs/messenger-platform/send-messages",
    envKeys: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    requiresAppReview: true,
    notes: "Needs a Page access token with pages_messaging. App review is required before sending to anyone outside your app's test users.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Messenger", "missing page access token");
    const ids = String(ctx.options.psids ?? "").split(/[\s,;]+/).filter(Boolean);
    const tag = String(ctx.options.tag ?? "");
    const m = ctx.media[0];

    const sent: string[] = [];
    for (const id of ids) {
      const res = await apiFetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`, {
        label: "Messenger send",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id },
          messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE",
          ...(tag ? { tag } : {}),
          message: m
            ? { attachment: { type: m.kind === "video" ? "video" : "image", payload: { url: ctx.publicUrl(m), is_reusable: true } } }
            : { text: ctx.body },
        }),
      });
      sent.push(String(res.message_id ?? id));
    }
    return { externalId: sent[0], note: `Sent to ${sent.length} recipient${sent.length === 1 ? "" : "s"}.` };
  },
};
