import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.twitch.tv/helix";

export const twitch: Platform = {
  id: "twitch",
  name: "Twitch",
  color: "#9146FF",
  category: "video",
  blurb: "Chat announcements to a live audience — drops, links and stream CTAs.",
  constraints: {
    textMax: 500,
    mediaMin: 0,
    mediaMax: 0,
    allowedMedia: [],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "broadcasterId", label: "Broadcaster user ID", type: "text", required: true },
    { key: "color", label: "Highlight colour", type: "select", defaultValue: "primary",
      choices: [
        { value: "primary", label: "Channel colour" }, { value: "blue", label: "Blue" },
        { value: "green", label: "Green" }, { value: "orange", label: "Orange" }, { value: "purple", label: "Purple" },
      ] },
  ],
  validate: ({ body }) => (
    body.length > 500 ? [{ level: "error" as const, message: "Twitch announcements are capped at 500 characters." }] : []
  ),
  manualSteps: (ctx) => [
    { label: `Open the ${ctx.channel.handle} chat` },
    { label: "Announcement", copy: `/announce ${ctx.body}` },
  ],
  liveSetup: {
    tokenLabel: "User access token",
    docsUrl: "https://dev.twitch.tv/docs/api/reference/#send-chat-announcement",
    envKeys: ["TWITCH_CLIENT_ID"],
    requiresAppReview: false,
    notes: "Register an app at dev.twitch.tv, run OAuth with moderator:manage:announcements, then paste the user access token and store the client id alongside it.",
  },
  credentialFields: [
    {
      key: "clientId",
      label: "Client ID",
      required: true,
      help: "From your app in the Twitch developer console."
    }
  ],
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    const clientId = ctx.credentials?.clientId;
    if (!token) throw new NotConnectedError("Twitch", "missing user access token");
    if (!clientId) throw new NotConnectedError("Twitch", "missing client id");
    const id = String(ctx.options.broadcasterId ?? ctx.channel.externalId ?? "");

    await apiFetch(`${API}/chat/announcements?broadcaster_id=${id}&moderator_id=${id}`, {
      label: "Twitch announcement",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId, "Content-Type": "application/json" },
      body: JSON.stringify({ message: ctx.body.slice(0, 500), color: String(ctx.options.color ?? "primary") }),
    });
    return { externalId: ctx.target.id, externalUrl: `https://twitch.tv/${ctx.channel.handle.replace(/^@/, "")}`, note: "Announcement sent to chat." };
  },
};
