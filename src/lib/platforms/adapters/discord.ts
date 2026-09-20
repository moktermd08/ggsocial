import { apiFetch, NotConnectedError, type Platform } from "../types";

export const discord: Platform = {
  id: "discord",
  name: "Discord",
  color: "#5865F2",
  category: "messaging",
  blurb: "Announcements into a server channel via webhook — community-led growth in one paste.",
  constraints: {
    textMax: 2000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image", "video", "document"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "username", label: "Override bot name", type: "text", placeholder: "Your Brand" },
    { key: "embedTitle", label: "Embed title", type: "text", help: "Turns the message into a rich embed with a link and image." },
    { key: "embedUrl", label: "Embed link", type: "text", placeholder: "https://…" },
    { key: "mention", label: "Mention", type: "select", defaultValue: "",
      choices: [{ value: "", label: "No ping" }, { value: "@here", label: "@here" }, { value: "@everyone", label: "@everyone" }] },
  ],
  manualSteps: (ctx) => [
    { label: `Open the Discord channel for ${ctx.channel.handle}` },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "Webhook URL",
    docsUrl: "https://discord.com/developers/docs/resources/webhook#execute-webhook",
    envKeys: [],
    requiresAppReview: false,
    notes: "Channel settings → Integrations → Webhooks → New Webhook. Paste the full webhook URL as the access token. No bot, no OAuth, no review.",
  },
  credentialFields: [
    {
      key: "webhookUrl",
      label: "Webhook URL (alternative)",
      help: "Only needed if you would rather not paste the URL as the token."
    }
  ],
  publish: async (ctx) => {
    const url = ctx.credentials?.webhookUrl ?? ctx.credentials?.accessToken;
    if (!url || !url.startsWith("http")) throw new NotConnectedError("Discord", "missing webhook URL");
    const mention = String(ctx.options.mention ?? "");
    const content = `${mention ? `${mention} ` : ""}${ctx.body}`.slice(0, 2000);

    const embeds = ctx.options.embedTitle
      ? [{
          title: String(ctx.options.embedTitle),
          description: ctx.body.slice(0, 4096),
          url: ctx.options.embedUrl ? String(ctx.options.embedUrl) : undefined,
          color: 0x5865f2,
          ...(ctx.media[0]?.kind === "image" ? { image: { url: ctx.publicUrl(ctx.media[0]) } } : {}),
        }]
      : undefined;

    // With an embed the text lives in the embed; otherwise media rides along as
    // plain links so Discord unfurls it inline.
    const body = embeds
      ? (mention || undefined)
      : ctx.media.length
        ? `${content}\n${ctx.media.map((m) => ctx.publicUrl(m)).join("\n")}`.slice(0, 2000)
        : content;

    const res = await apiFetch(`${url}?wait=true`, {
      label: "Discord webhook",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: body,
        username: ctx.options.username ? String(ctx.options.username) : undefined,
        embeds,
        // "everyone" covers @here too; without it Discord silently strips the ping.
        allowed_mentions: { parse: mention ? ["everyone"] : [] },
      }),
    });
    const id = String(res.id ?? "");
    return { externalId: id, note: "Posted via webhook." };
  },
};
