import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.vimeo.com";

export const vimeo: Platform = {
  id: "vimeo",
  name: "Vimeo",
  color: "#1AB7EA",
  category: "video",
  blurb: "Clean, ad-free video hosting for embeds, case studies and sales pages.",
  constraints: {
    textMax: 5000,
    mediaMin: 1,
    mediaMax: 1,
    allowedMedia: ["video"],
    requiresMedia: true,
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "privacy", label: "Privacy", type: "select", defaultValue: "anybody",
      choices: [
        { value: "anybody", label: "Public" },
        { value: "unlisted", label: "Unlisted" },
        { value: "nobody", label: "Private" },
      ] },
    { key: "folderUri", label: "Folder URI", type: "text", placeholder: "/users/123/projects/456" },
  ],
  validate: ({ options }) => (
    String(options.title ?? "").trim() ? [] : [{ level: "error" as const, message: "Vimeo uploads need a title." }]
  ),
  manualSteps: (ctx) => [
    { label: "Open vimeo.com/upload" },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Description", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developer.vimeo.com/api/upload/videos#pull-approach",
    envKeys: ["VIMEO_CLIENT_ID", "VIMEO_CLIENT_SECRET"],
    requiresAppReview: true,
    notes: "Create an app at developer.vimeo.com, request upload scope (granted on request), then paste the personal access token. Uses the pull approach — the file URL must be publicly reachable.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Vimeo", "missing access token");
    const video = ctx.media[0];
    if (!video) throw new Error("Vimeo needs a video file.");

    const res = await apiFetch(`${API}/me/videos`, {
      label: "Vimeo upload",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.vimeo.*+json;version=3.4",
      },
      body: JSON.stringify({
        upload: { approach: "pull", link: ctx.publicUrl(video) },
        name: String(ctx.options.title ?? ctx.post.title ?? ""),
        description: ctx.body,
        privacy: { view: String(ctx.options.privacy ?? "anybody") },
        ...(ctx.options.folderUri ? { folder_uri: String(ctx.options.folderUri) } : {}),
      }),
    });
    const uri = String(res.uri ?? "");
    return {
      externalId: uri.split("/").pop(),
      externalUrl: String(res.link ?? ""),
      note: "Vimeo is pulling and transcoding the file — it goes live once that finishes.",
    };
  },
};
