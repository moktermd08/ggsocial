import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://open.tiktokapis.com/v2";

export const tiktok: Platform = {
  id: "tiktok",
  name: "TikTok",
  color: "#FE2C55",
  category: "video",
  blurb: "Video posts (and photo carousels) through the TikTok Content Posting API.",
  constraints: {
    textMax: 2200,
    mediaMin: 1,
    mediaMax: 35,
    allowedMedia: ["image", "video"],
    videoMaxSeconds: 600,
    requiresMedia: true,
    supportsLinks: false,
    hashtagsUseful: true,
    aspectRatioHint: "9:16",
  },
  optionFields: [
    { key: "privacy", label: "Privacy", type: "select", defaultValue: "PUBLIC_TO_EVERYONE",
      choices: [
        { value: "PUBLIC_TO_EVERYONE", label: "Public" },
        { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
        { value: "SELF_ONLY", label: "Private" },
      ] },
    { key: "disableComment", label: "Turn comments off", type: "boolean", defaultValue: false },
    { key: "disableDuet", label: "Turn duets off", type: "boolean", defaultValue: false },
    { key: "disableStitch", label: "Turn stitches off", type: "boolean", defaultValue: false },
    { key: "brandContent", label: "Branded content disclosure", type: "boolean", defaultValue: false },
  ],
  validate: ({ body, media }) => {
    const issues = [];
    if (media.length === 0) issues.push({ level: "error" as const, message: "TikTok needs a video or photo set." });
    if (body.length > 2200) issues.push({ level: "error" as const, message: "Caption is capped at 2,200 characters." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open TikTok as ${ctx.channel.handle}` },
    { label: "Upload the video", detail: ctx.media[0]?.originalName },
    { label: "Paste the caption", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    envKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    requiresAppReview: true,
    notes:
      "Needs video.publish scope and audit of the Content Posting API. Until the app is audited, posts land as private drafts in the creator's inbox.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("TikTok", "missing access token");
    const video = ctx.media.find((m) => m.kind === "video");
    if (!video) throw new Error("TikTok publishing through the API requires a video file.");

    const init = await apiFetch(`${API}/post/publish/video/init/`, {
      label: "TikTok publish init",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        post_info: {
          title: ctx.body.slice(0, 2200),
          privacy_level: String(ctx.options.privacy ?? "PUBLIC_TO_EVERYONE"),
          disable_comment: Boolean(ctx.options.disableComment),
          disable_duet: Boolean(ctx.options.disableDuet),
          disable_stitch: Boolean(ctx.options.disableStitch),
          brand_content_toggle: Boolean(ctx.options.brandContent),
        },
        source_info: { source: "PULL_FROM_URL", video_url: ctx.publicUrl(video) },
      }),
    });
    const publishId = String((init.data as { publish_id?: string } | undefined)?.publish_id ?? "");
    return { externalId: publishId, note: "TikTok processes the upload asynchronously; check the account for the final post." };
  },
};
