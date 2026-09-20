import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.x.com/2";
const UPLOAD = "https://upload.x.com/1.1/media/upload.json";

export const x: Platform = {
  id: "x",
  name: "X",
  color: "#111111",
  category: "social",
  blurb: "Posts and threads on X (Twitter), with up to four images or one video.",
  constraints: {
    textMax: 280,
    mediaMin: 0,
    mediaMax: 4,
    allowedMedia: ["image", "video"],
    videoMaxSeconds: 140,
    supportsLinks: true,
    hashtagsUseful: true,
    aspectRatioHint: "16:9 or 1:1",
  },
  optionFields: [
    { key: "thread", label: "Thread (one post per blank line)", type: "boolean", defaultValue: false,
      help: "Splits the copy on blank lines and posts each part as a reply to the previous one." },
    { key: "replySettings", label: "Who can reply", type: "select", defaultValue: "everyone",
      choices: [
        { value: "everyone", label: "Everyone" },
        { value: "mentionedUsers", label: "Mentioned users" },
        { value: "following", label: "Accounts you follow" },
      ] },
  ],
  validate: ({ body, options }) => {
    const issues = [];
    const parts = options.thread ? body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [body];
    parts.forEach((p, i) => {
      if (p.length > 280) {
        issues.push({ level: "error" as const, message: `Part ${i + 1} is ${p.length} characters (max 280).` });
      }
    });
    if (options.thread && parts.length < 2) {
      issues.push({ level: "warn" as const, message: "Thread mode is on but the copy has no blank-line breaks." });
    }
    return issues;
  },
  manualSteps: (ctx) => {
    const parts = ctx.options.thread ? ctx.body.split(/\n{2,}/).filter((p) => p.trim()) : [ctx.body];
    return [
      { label: `Open X as ${ctx.channel.handle}` },
      ...parts.map((p, i) => ({ label: parts.length > 1 ? `Post ${i + 1} of ${parts.length}` : "Paste the post", copy: p })),
    ];
  },
  liveSetup: {
    docsUrl: "https://docs.x.com/x-api/posts/creation-of-a-post",
    envKeys: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    requiresAppReview: false,
    notes: "Write access needs at least the Basic tier of the X API. OAuth 2.0 user context with tweet.write + media.write.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("X", "missing access token");

    const mediaIds: string[] = [];
    for (const m of ctx.media.slice(0, 4)) {
      const blob = await fetch(ctx.publicUrl(m)).then((r) => r.blob());
      const form = new FormData();
      form.append("media", blob, m.originalName);
      const up = await apiFetch(UPLOAD, { label: "X media upload", method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      mediaIds.push(String(up.media_id_string));
    }

    const parts = ctx.options.thread
      ? ctx.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
      : [ctx.body];

    let replyTo: string | undefined;
    let firstId = "";
    for (const [i, text] of parts.entries()) {
      const res = await apiFetch(`${API}/tweets`, {
        label: "X post",
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(i === 0 && mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
          ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
          ...(i === 0 && ctx.options.replySettings && ctx.options.replySettings !== "everyone"
            ? { reply_settings: String(ctx.options.replySettings) } : {}),
        }),
      });
      const id = String((res.data as { id: string }).id);
      if (i === 0) firstId = id;
      replyTo = id;
    }
    return { externalId: firstId, externalUrl: `https://x.com/${ctx.channel.handle.replace(/^@/, "")}/status/${firstId}` };
  },
  fetchMetrics: async ({ externalPostId, credentials }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("X", "missing access token");
    const res = await apiFetch(
      `${API}/tweets/${externalPostId}?tweet.fields=public_metrics,non_public_metrics`,
      { label: "X metrics", headers: { Authorization: `Bearer ${token}` } },
    );
    const d = (res.data ?? {}) as { public_metrics?: Record<string, number>; non_public_metrics?: Record<string, number> };
    const p = d.public_metrics ?? {};
    return {
      impressions: d.non_public_metrics?.impression_count ?? p.impression_count,
      likes: p.like_count, commentCount: p.reply_count, shares: p.retweet_count,
      clicks: d.non_public_metrics?.url_link_clicks, raw: res,
    };
  },
};
