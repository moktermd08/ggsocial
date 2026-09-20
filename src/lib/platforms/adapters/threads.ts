import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://graph.threads.net/v1.0";

export const threads: Platform = {
  id: "threads",
  name: "Threads",
  color: "#000000",
  category: "social",
  blurb: "Short text posts with optional image or video, via the Threads API.",
  constraints: {
    textMax: 500,
    mediaMin: 0,
    mediaMax: 20,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: true,
    aspectRatioHint: "up to 10:1 wide, 4:5 tall",
  },
  optionFields: [
    { key: "replyControl", label: "Who can reply", type: "select", defaultValue: "everyone",
      choices: [
        { value: "everyone", label: "Everyone" },
        { value: "accounts_you_follow", label: "Accounts you follow" },
        { value: "mentioned_only", label: "Mentioned only" },
      ] },
  ],
  validate: ({ body }) =>
    body.length > 500 ? [{ level: "error" as const, message: "Threads posts are capped at 500 characters." }] : [],
  manualSteps: (ctx) => [
    { label: `Open Threads as ${ctx.channel.handle}` },
    { label: "Paste the post", copy: ctx.body },
    ...(ctx.media.length ? [{ label: `Attach ${ctx.media.length} file(s)` }] : []),
  ],
  liveSetup: {
    docsUrl: "https://developers.facebook.com/docs/threads",
    envKeys: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
    requiresAppReview: true,
    notes: "Threads API uses its own app scopes (threads_basic, threads_content_publish) on a Meta app.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    const userId = ctx.channel.externalId;
    if (!token || !userId) throw new NotConnectedError("Threads", "missing access token or user id");

    const create = (params: Record<string, string>) =>
      apiFetch(`${API}/${userId}/threads`, {
        label: "Threads container",
        method: "POST",
        body: new URLSearchParams({ ...params, access_token: token }),
      });

    let creationId: string;
    if (ctx.media.length > 1) {
      const children: string[] = [];
      for (const m of ctx.media) {
        const child = await create({
          media_type: m.kind === "video" ? "VIDEO" : "IMAGE",
          is_carousel_item: "true",
          ...(m.kind === "video" ? { video_url: ctx.publicUrl(m) } : { image_url: ctx.publicUrl(m) }),
        });
        children.push(String(child.id));
      }
      creationId = String((await create({ media_type: "CAROUSEL", children: children.join(","), text: ctx.body })).id);
    } else if (ctx.media.length === 1) {
      const m = ctx.media[0];
      creationId = String((await create({
        media_type: m.kind === "video" ? "VIDEO" : "IMAGE",
        ...(m.kind === "video" ? { video_url: ctx.publicUrl(m) } : { image_url: ctx.publicUrl(m) }),
        text: ctx.body,
        reply_control: String(ctx.options.replyControl ?? "everyone"),
      })).id);
    } else {
      creationId = String((await create({ media_type: "TEXT", text: ctx.body, reply_control: String(ctx.options.replyControl ?? "everyone") })).id);
    }

    const res = await apiFetch(`${API}/${userId}/threads_publish`, {
      label: "Threads publish",
      method: "POST",
      body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    });
    return { externalId: String(res.id), externalUrl: `https://www.threads.net/@${ctx.channel.handle.replace(/^@/, "")}` };
  },
};
