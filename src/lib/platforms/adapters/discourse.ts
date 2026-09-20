import { apiFetch, NotConnectedError, type Platform } from "../types";

export const discourse: Platform = {
  id: "discourse",
  name: "Discourse",
  color: "#000000",
  category: "community",
  blurb: "Topics in your own forum or any Discourse community that allows API posting.",
  constraints: {
    textMax: 32000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "siteUrl", label: "Forum URL", type: "text", required: true, placeholder: "https://community.yourbrand.com" },
    { key: "title", label: "Topic title", type: "text", required: true },
    { key: "categoryId", label: "Category ID", type: "number" },
    { key: "tags", label: "Tags", type: "text", placeholder: "announcements, product" },
    { key: "topicId", label: "Reply to topic ID", type: "number", help: "Leave blank to start a new topic." },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.siteUrl ?? "").trim()) issues.push({ level: "error" as const, message: "Set the forum URL." });
    if (!options.topicId && !String(options.title ?? "").trim()) {
      issues.push({ level: "error" as const, message: "New topics need a title." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.siteUrl ?? "")}` },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "API key",
    docsUrl: "https://docs.discourse.org/#tag/Posts/operation/createTopicPostPM",
    envKeys: [],
    requiresAppReview: false,
    notes: "Admin → API → New API Key. Paste the key as the access token and the Discourse username as the account ID.",
  },
  credentialFields: [
    {
      key: "username",
      label: "Api-Username",
      required: true,
      placeholder: "system",
      help: "The Discourse account the post is attributed to."
    }
  ],
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    const username = ctx.credentials?.username ?? ctx.channel.externalId ?? "system";
    if (!key) throw new NotConnectedError("Discourse", "missing API key");
    const raw0 = String(ctx.options.siteUrl ?? "");
    const base = (raw0.startsWith("http") ? raw0 : `https://${raw0}`).replace(/\/$/, "");

    const raw = [ctx.body, ...ctx.media.filter((m) => m.kind === "image").map((m) => `![${m.altText ?? m.originalName}](${ctx.publicUrl(m)})`)].join("\n\n");

    const res = await apiFetch(`${base}/posts.json`, {
      label: "Discourse post",
      method: "POST",
      headers: { "Api-Key": key, "Api-Username": username, "Content-Type": "application/json" },
      body: JSON.stringify({
        raw,
        ...(ctx.options.topicId
          ? { topic_id: Number(ctx.options.topicId) }
          : {
              title: String(ctx.options.title ?? ""),
              category: ctx.options.categoryId ? Number(ctx.options.categoryId) : undefined,
              tags: String(ctx.options.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
            }),
      }),
    });
    const id = String(res.id ?? "");
    const slug = res.topic_slug ? String(res.topic_slug) : null;
    return { externalId: id, externalUrl: slug ? `${base}/t/${slug}/${String(res.topic_id)}` : undefined };
  },
};
