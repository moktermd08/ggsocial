import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.line.me/v2/bot";

export const line: Platform = {
  id: "line",
  name: "LINE",
  color: "#06C755",
  category: "messaging",
  blurb: "Official Account broadcasts — the default marketing channel in Japan, Thailand and Taiwan.",
  constraints: {
    textMax: 5000,
    mediaMin: 0,
    mediaMax: 5,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "mode", label: "Audience", type: "select", defaultValue: "broadcast",
      choices: [{ value: "broadcast", label: "All followers" }, { value: "narrowcast", label: "Segment (audience group)" }] },
    { key: "audienceGroupId", label: "Audience group ID", type: "text", help: "Required for a narrowcast send." },
    { key: "notificationDisabled", label: "Send quietly", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => (
    options.mode === "narrowcast" && !String(options.audienceGroupId ?? "").trim()
      ? [{ level: "error" as const, message: "A narrowcast needs an audience group ID." }]
      : [{ level: "warn" as const, message: "Broadcasts count against the Official Account's monthly message quota." }]
  ),
  manualSteps: (ctx) => [
    { label: "Open LINE Official Account Manager" },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.line.biz/en/reference/messaging-api/#send-broadcast-message",
    envKeys: ["LINE_CHANNEL_SECRET"],
    requiresAppReview: false,
    notes: "Create a Messaging API channel in the LINE Developers console and paste the long-lived channel access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("LINE", "missing channel access token");
    const narrowcast = String(ctx.options.mode ?? "broadcast") === "narrowcast";

    const messages: unknown[] = [];
    if (ctx.body.trim()) messages.push({ type: "text", text: ctx.body.slice(0, 5000) });
    for (const m of ctx.media.slice(0, 4)) {
      const url = ctx.publicUrl(m);
      messages.push(m.kind === "video"
        ? { type: "video", originalContentUrl: url, previewImageUrl: url }
        : { type: "image", originalContentUrl: url, previewImageUrl: url });
    }
    if (!messages.length) throw new Error("Nothing to send.");

    await apiFetch(`${API}/message/${narrowcast ? "narrowcast" : "broadcast"}`, {
      label: "LINE broadcast",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": ctx.target.id,
      },
      body: JSON.stringify({
        messages: messages.slice(0, 5),
        notificationDisabled: Boolean(ctx.options.notificationDisabled),
        ...(narrowcast
          ? { recipient: { type: "audience", audienceGroupId: Number(ctx.options.audienceGroupId) } }
          : {}),
      }),
    });
    return { externalId: ctx.target.id, note: narrowcast ? "Narrowcast queued by LINE." : "Broadcast sent to all followers." };
  },
};
