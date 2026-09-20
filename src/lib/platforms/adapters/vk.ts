import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.vk.com/method";
const VERSION = "5.199";

export const vk: Platform = {
  id: "vk",
  name: "VK",
  color: "#0077FF",
  category: "social",
  blurb: "Wall posts to a VK profile or community — the main social surface in CIS markets.",
  constraints: {
    textMax: 16000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "ownerId", label: "Owner ID", type: "text", required: true, help: "Community IDs are negative, e.g. -123456789. A user ID is positive." },
    { key: "fromGroup", label: "Post as the community", type: "boolean", defaultValue: true },
    { key: "link", label: "Attached link", type: "text", placeholder: "https://…" },
  ],
  manualSteps: (ctx) => [
    { label: `Open VK as ${ctx.channel.handle}` },
    { label: "Post text", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://dev.vk.com/en/method/wall.post",
    envKeys: ["VK_APP_ID", "VK_APP_SECRET"],
    requiresAppReview: false,
    notes: "Create a standalone app at vk.com/apps?act=manage and issue a community token with the 'wall' and 'photos' scopes.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("VK", "missing access token");
    const ownerId = String(ctx.options.ownerId ?? ctx.channel.externalId ?? "");
    if (!ownerId) throw new Error("VK needs an owner ID (community IDs are negative).");

    // VK takes remote media as link attachments; native uploads need the
    // per-album upload-server dance, which the queue handles manually.
    const attachments = ctx.options.link
      ? String(ctx.options.link)
      : ctx.media[0]
        ? ctx.publicUrl(ctx.media[0])
        : "";

    const params = new URLSearchParams({
      owner_id: ownerId,
      from_group: ctx.options.fromGroup === false ? "0" : "1",
      message: ctx.body,
      access_token: token,
      v: VERSION,
      ...(attachments ? { attachments } : {}),
    });

    const res = await apiFetch(`${API}/wall.post`, {
      label: "VK wall.post",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (res.error) throw new Error(`VK rejected the post: ${JSON.stringify(res.error).slice(0, 300)}`);
    const postId = String((res.response as Record<string, unknown>)?.post_id ?? "");
    return { externalId: postId, externalUrl: postId ? `https://vk.com/wall${ownerId}_${postId}` : undefined };
  },
};
