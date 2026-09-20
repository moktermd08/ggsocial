import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://oauth.reddit.com";

export const reddit: Platform = {
  id: "reddit",
  name: "Reddit",
  color: "#FF4500",
  category: "social",
  blurb: "Text, link and image submissions to a subreddit or your profile.",
  constraints: {
    textMax: 40000,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "subreddit", label: "Subreddit", type: "text", required: true, placeholder: "r/yoursubreddit" },
    { key: "title", label: "Post title", type: "text", required: true, help: "Max 300 characters." },
    { key: "kind", label: "Type", type: "select", defaultValue: "self",
      choices: [
        { value: "self", label: "Text post" },
        { value: "link", label: "Link" },
        { value: "image", label: "Image" },
      ] },
    { key: "url", label: "Link URL", type: "text", placeholder: "https://…" },
    { key: "flairId", label: "Flair ID", type: "text", help: "Many subreddits reject posts without flair." },
    { key: "nsfw", label: "Mark NSFW", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => {
    const issues = [];
    const title = String(options.title ?? "");
    if (!title.trim()) issues.push({ level: "error" as const, message: "Reddit posts need a title." });
    if (title.length > 300) issues.push({ level: "error" as const, message: "Title is capped at 300 characters." });
    if (!String(options.subreddit ?? "").trim()) issues.push({ level: "error" as const, message: "Pick a subreddit." });
    if (options.kind === "link" && !options.url) issues.push({ level: "error" as const, message: "Link posts need a URL." });
    issues.push({ level: "warn" as const, message: "Check the subreddit's self-promotion rules before posting brand content." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.subreddit ?? "")} as ${ctx.channel.handle}` },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://www.reddit.com/dev/api/#POST_api_submit",
    envKeys: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    requiresAppReview: false,
    notes: "Register a 'web app' at reddit.com/prefs/apps. Scopes: submit, identity, read. Send a descriptive User-Agent.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Reddit", "missing access token");
    const sr = String(ctx.options.subreddit ?? "").replace(/^\/?r\//, "");
    const kind = String(ctx.options.kind ?? "self");

    const params = new URLSearchParams({
      sr,
      kind: kind === "image" ? "image" : kind,
      title: String(ctx.options.title ?? ""),
      api_type: "json",
      nsfw: String(Boolean(ctx.options.nsfw)),
      ...(kind === "self" ? { text: ctx.body } : {}),
      ...(kind === "link" ? { url: String(ctx.options.url ?? "") } : {}),
      ...(kind === "image" && ctx.media[0] ? { url: ctx.publicUrl(ctx.media[0]) } : {}),
      ...(ctx.options.flairId ? { flair_id: String(ctx.options.flairId) } : {}),
    });

    const res = await apiFetch(`${API}/api/submit`, {
      label: "Reddit submit",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ggsocial/1.0 (scheduling client)",
      },
      body: params,
    });
    const data = (res.json as { data?: { id?: string; url?: string }; errors?: unknown[] }) ?? {};
    if (data.errors?.length) throw new Error(`Reddit rejected the post: ${JSON.stringify(data.errors).slice(0, 300)}`);
    return { externalId: data.data?.id, externalUrl: data.data?.url };
  },
};
