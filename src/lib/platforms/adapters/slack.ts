import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://slack.com/api";

export const slack: Platform = {
  id: "slack",
  name: "Slack",
  color: "#4A154B",
  category: "messaging",
  blurb: "Posts into your own workspace or a partner community channel.",
  constraints: {
    textMax: 4000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image", "video", "document"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "channel", label: "Channel", type: "text", required: true, placeholder: "#announcements or C0123456789" },
    { key: "threadTs", label: "Reply in thread (ts)", type: "text", help: "Optional parent message timestamp." },
    { key: "unfurl", label: "Unfurl links", type: "boolean", defaultValue: true },
  ],
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.channel ?? ctx.channel.handle)} in Slack` },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://api.slack.com/methods/chat.postMessage",
    envKeys: [],
    requiresAppReview: false,
    notes: "Create an app at api.slack.com/apps, add the chat:write scope, install it to the workspace and paste the Bot User OAuth token (xoxb-…). Invite the bot to the channel.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Slack", "missing bot token");
    const channel = String(ctx.options.channel ?? ctx.channel.externalId ?? ctx.channel.handle);

    const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: ctx.body.slice(0, 3000) } }];
    for (const m of ctx.media.filter((x) => x.kind === "image").slice(0, 5)) {
      blocks.push({ type: "image", image_url: ctx.publicUrl(m), alt_text: m.altText ?? m.originalName });
    }

    const res = await apiFetch(`${API}/chat.postMessage`, {
      label: "Slack post",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel,
        text: ctx.body.slice(0, 4000),
        blocks,
        unfurl_links: ctx.options.unfurl !== false,
        ...(ctx.options.threadTs ? { thread_ts: String(ctx.options.threadTs) } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Slack rejected the message: ${String(res.error ?? "unknown error")}`);
    return { externalId: String(res.ts ?? ""), externalUrl: undefined };
  },
};
