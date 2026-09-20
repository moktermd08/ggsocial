import { apiFetch, NotConnectedError, type Platform } from "../types";

function base(ctx: { channel: { settings: unknown }; options: Record<string, unknown> }) {
  const s = (ctx.channel.settings ?? {}) as Record<string, unknown>;
  const raw = String(ctx.options.instance ?? s.instance ?? "https://lemmy.world");
  return (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
}

export const lemmy: Platform = {
  id: "lemmy",
  name: "Lemmy",
  color: "#00BC8C",
  category: "community",
  blurb: "Community submissions on the federated Reddit alternative.",
  constraints: {
    textMax: 10000,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "instance", label: "Instance URL", type: "text", required: true, placeholder: "https://lemmy.world" },
    { key: "communityId", label: "Community ID", type: "number", required: true, help: "Numeric id — check /api/v3/community?name=yourcommunity." },
    { key: "title", label: "Post title", type: "text", required: true },
    { key: "url", label: "Link URL", type: "text", placeholder: "https://…" },
    { key: "nsfw", label: "Mark NSFW", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.title ?? "").trim()) issues.push({ level: "error" as const, message: "Lemmy posts need a title." });
    issues.push({ level: "warn" as const, message: "Check the community's self-promotion rules first." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.instance ?? "")} as ${ctx.channel.handle}` },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://join-lemmy.org/api/classes/LemmyHttp.html",
    envKeys: [],
    requiresAppReview: false,
    notes: "Log in once via /api/v3/user/login on your instance and paste the returned JWT as the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Lemmy", "missing JWT");
    const host = base(ctx);
    const res = await apiFetch(`${host}/api/v3/post`, {
      label: "Lemmy post",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(ctx.options.title ?? "").slice(0, 200),
        body: ctx.body || undefined,
        community_id: Number(ctx.options.communityId),
        url: ctx.options.url ? String(ctx.options.url) : ctx.media[0] ? ctx.publicUrl(ctx.media[0]) : undefined,
        nsfw: Boolean(ctx.options.nsfw),
      }),
    });
    const view = (res.post_view as Record<string, unknown>) ?? {};
    const post = (view.post as Record<string, unknown>) ?? {};
    return { externalId: String(post.id ?? ""), externalUrl: String(post.ap_id ?? "") };
  },
};
