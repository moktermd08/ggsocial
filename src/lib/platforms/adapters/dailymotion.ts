import { apiFetch, fetchMediaBytes, NotConnectedError, type Platform } from "../types";

const API = "https://api.dailymotion.com";

export const dailymotion: Platform = {
  id: "dailymotion",
  name: "Dailymotion",
  color: "#0066DC",
  category: "video",
  blurb: "A second home for every video you make — extra search surface at no extra production cost.",
  constraints: {
    textMax: 3000,
    mediaMin: 1,
    mediaMax: 1,
    allowedMedia: ["video"],
    requiresMedia: true,
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "channel", label: "Category", type: "select", defaultValue: "tech",
      choices: [
        { value: "tech", label: "Tech" }, { value: "news", label: "News" },
        { value: "business", label: "Business" }, { value: "lifestyle", label: "Lifestyle" },
        { value: "fun", label: "Fun" }, { value: "creation", label: "Creation" },
      ] },
    { key: "tags", label: "Tags", type: "text", placeholder: "saas, marketing" },
    { key: "published", label: "Publish immediately", type: "boolean", defaultValue: true },
    { key: "isCreatedForKids", label: "Made for kids", type: "boolean", defaultValue: false },
  ],
  validate: ({ options }) => (
    String(options.title ?? "").trim() ? [] : [{ level: "error" as const, message: "Dailymotion uploads need a title." }]
  ),
  manualSteps: (ctx) => [
    { label: "Open dailymotion.com/upload" },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Description", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.dailymotion.com/guides/upload-video/",
    envKeys: ["DAILYMOTION_API_KEY", "DAILYMOTION_API_SECRET"],
    requiresAppReview: false,
    notes: "Register an API key at developers.dailymotion.com, run OAuth with the manage_videos scope and paste the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Dailymotion", "missing access token");
    const video = ctx.media[0];
    const auth = { Authorization: `Bearer ${token}` };

    // Dailymotion hands out a one-shot upload URL, then the video is created from it.
    const slot = await apiFetch(`${API}/file/upload`, { label: "Dailymotion upload slot", method: "GET", headers: auth });
    const uploadUrl = String(slot.upload_url ?? "");
    if (!uploadUrl) throw new Error("Dailymotion did not return an upload URL.");

    const { bytes, contentType } = await fetchMediaBytes(ctx.publicUrl(video));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), video.originalName);
    const uploaded = await apiFetch(uploadUrl, { label: "Dailymotion file upload", method: "POST", body: form });

    const res = await apiFetch(`${API}/me/videos`, {
      label: "Dailymotion video",
      method: "POST",
      headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        url: String(uploaded.url ?? ""),
        title: String(ctx.options.title ?? ctx.post.title ?? ""),
        description: ctx.body.slice(0, 3000),
        channel: String(ctx.options.channel ?? "tech"),
        tags: String(ctx.options.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).join(","),
        published: String(ctx.options.published !== false),
        is_created_for_kids: String(Boolean(ctx.options.isCreatedForKids)),
      }),
    });
    const id = String(res.id ?? "");
    return { externalId: id, externalUrl: id ? `https://www.dailymotion.com/video/${id}` : undefined };
  },
};
