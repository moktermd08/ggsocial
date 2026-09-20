import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.onesignal.com";

export const onesignal: Platform = {
  id: "onesignal",
  name: "Push (OneSignal)",
  color: "#E54B4D",
  category: "email",
  blurb: "Web and mobile push to people who already installed or visited — cheap re-engagement.",
  constraints: {
    textMax: 200,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "heading", label: "Title", type: "text", required: true, help: "Keep under 40 characters — phones truncate hard." },
    { key: "url", label: "Landing URL", type: "text", placeholder: "https://…" },
    { key: "segment", label: "Segment", type: "text", defaultValue: "Subscribed Users" },
  ],
  validate: ({ options, body }) => {
    const issues = [];
    if (!String(options.heading ?? "").trim()) issues.push({ level: "error" as const, message: "Push notifications need a title." });
    if (body.length > 200) issues.push({ level: "error" as const, message: "Keep the push body under 200 characters." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open OneSignal → Messages → New Push" },
    { label: "Title", copy: String(ctx.options.heading ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "REST API key",
    docsUrl: "https://documentation.onesignal.com/reference/create-notification",
    envKeys: [],
    requiresAppReview: false,
    notes: "Settings → Keys & IDs. Paste the REST API key as the access token and the App ID as the account ID.",
  },
  credentialFields: [
    {
      key: "appId",
      label: "App ID",
      required: true
    }
  ],
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    const appId = ctx.credentials?.appId ?? ctx.channel.externalId;
    if (!key) throw new NotConnectedError("Push (OneSignal)", "missing REST API key");
    if (!appId) throw new NotConnectedError("Push (OneSignal)", "missing App ID");
    const image = ctx.media.find((m) => m.kind === "image");

    const res = await apiFetch(`${API}/notifications`, {
      label: "OneSignal push",
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: appId,
        included_segments: [String(ctx.options.segment ?? "Subscribed Users")],
        headings: { en: String(ctx.options.heading ?? "") },
        contents: { en: ctx.body.slice(0, 200) },
        ...(ctx.options.url ? { url: String(ctx.options.url) } : {}),
        ...(image ? { big_picture: ctx.publicUrl(image), chrome_web_image: ctx.publicUrl(image) } : {}),
      }),
    });
    return { externalId: String(res.id ?? ""), note: `Queued for ${String(res.recipients ?? "?")} recipients.` };
  },
};
