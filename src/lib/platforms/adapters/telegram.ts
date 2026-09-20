import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.telegram.org";

/** Telegram's caption limit is far shorter than its message limit. */
const TEXT_MAX = 4096;
const CAPTION_MAX = 1024;

export const telegram: Platform = {
  id: "telegram",
  name: "Telegram",
  color: "#229ED9",
  category: "messaging",
  blurb: "Channel, group and DM broadcasts through a bot — instant setup, no review, no rate pain.",
  constraints: {
    textMax: TEXT_MAX,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image", "video", "document"],
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "chatId", label: "Chat ID or @channel", type: "text", required: true, placeholder: "@yourchannel or -1001234567890" },
    { key: "parseMode", label: "Formatting", type: "select", defaultValue: "HTML",
      choices: [{ value: "HTML", label: "HTML" }, { value: "MarkdownV2", label: "MarkdownV2" }, { value: "", label: "Plain text" }] },
    { key: "silent", label: "Send silently", type: "boolean", defaultValue: false },
    { key: "disablePreview", label: "Hide link preview", type: "boolean", defaultValue: false },
    { key: "buttonText", label: "Button label", type: "text", placeholder: "Book a call", help: "Adds an inline CTA button — the highest-converting element here." },
    { key: "buttonUrl", label: "Button link", type: "text", placeholder: "https://…" },
  ],
  validate: ({ body, media, options }) => {
    const issues = [];
    if (media.length && body.length > CAPTION_MAX) {
      issues.push({ level: "error" as const, message: `With media attached Telegram caps the caption at ${CAPTION_MAX} characters (${body.length} now).` });
    }
    if (options.buttonText && !options.buttonUrl) {
      issues.push({ level: "error" as const, message: "A button needs a link." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.chatId ?? ctx.channel.handle)} in Telegram` },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://core.telegram.org/bots/api#sendmessage",
    envKeys: [],
    requiresAppReview: false,
    notes: "Talk to @BotFather, create a bot, paste its token as the access token, then add the bot to your channel as an admin with 'Post messages'.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Telegram", "missing bot token");
    const chatId = String(ctx.options.chatId ?? ctx.channel.externalId ?? ctx.channel.handle);
    const parseMode = String(ctx.options.parseMode ?? "HTML");
    const shared = {
      chat_id: chatId,
      disable_notification: Boolean(ctx.options.silent),
      ...(parseMode ? { parse_mode: parseMode } : {}),
    };
    const markup = ctx.options.buttonText && ctx.options.buttonUrl
      ? { reply_markup: { inline_keyboard: [[{ text: String(ctx.options.buttonText), url: String(ctx.options.buttonUrl) }]] } }
      : {};

    const call = (method: string, payload: Record<string, unknown>) =>
      apiFetch(`${API}/bot${token}/${method}`, {
        label: `Telegram ${method}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    let res: Record<string, unknown>;
    if (ctx.media.length > 1) {
      // Albums cannot carry a keyboard; the caption rides on the first item.
      res = await call("sendMediaGroup", {
        ...shared,
        media: ctx.media.slice(0, 10).map((m, i) => ({
          type: m.kind === "video" ? "video" : m.kind === "document" ? "document" : "photo",
          media: ctx.publicUrl(m),
          ...(i === 0 && ctx.body ? { caption: ctx.body.slice(0, CAPTION_MAX), ...(parseMode ? { parse_mode: parseMode } : {}) } : {}),
        })),
      });
    } else if (ctx.media.length === 1) {
      const m = ctx.media[0];
      const method = m.kind === "video" ? "sendVideo" : m.kind === "document" ? "sendDocument" : "sendPhoto";
      const key = m.kind === "video" ? "video" : m.kind === "document" ? "document" : "photo";
      res = await call(method, { ...shared, ...markup, [key]: ctx.publicUrl(m), caption: ctx.body.slice(0, CAPTION_MAX) });
    } else {
      res = await call("sendMessage", {
        ...shared, ...markup,
        text: ctx.body,
        link_preview_options: { is_disabled: Boolean(ctx.options.disablePreview) },
      });
    }

    const result = Array.isArray(res.result) ? (res.result[0] as Record<string, unknown>) : (res.result as Record<string, unknown>);
    const messageId = String(result?.message_id ?? "");
    const publicName = chatId.startsWith("@") ? chatId.slice(1) : null;
    return {
      externalId: messageId,
      externalUrl: publicName && messageId ? `https://t.me/${publicName}/${messageId}` : undefined,
    };
  },
};
