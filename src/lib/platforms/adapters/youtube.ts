import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

export const youtube: Platform = {
  id: "youtube",
  name: "YouTube",
  color: "#FF0000",
  category: "video",
  blurb: "Long-form uploads and Shorts, with title, description, tags and privacy.",
  constraints: {
    textMax: 5000,
    mediaMin: 1,
    mediaMax: 1,
    allowedMedia: ["video"],
    requiresMedia: true,
    supportsLinks: true,
    hashtagsUseful: true,
    aspectRatioHint: "16:9, or 9:16 for Shorts",
  },
  optionFields: [
    { key: "title", label: "Video title", type: "text", required: true, help: "Max 100 characters." },
    { key: "privacy", label: "Privacy", type: "select", defaultValue: "public",
      choices: [
        { value: "public", label: "Public" },
        { value: "unlisted", label: "Unlisted" },
        { value: "private", label: "Private" },
      ] },
    { key: "categoryId", label: "Category ID", type: "text", defaultValue: "22", help: "22 = People & Blogs, 28 = Science & Tech." },
    { key: "madeForKids", label: "Made for kids", type: "boolean", defaultValue: false },
    { key: "tags", label: "Tags (comma separated)", type: "text" },
  ],
  validate: ({ media, options }) => {
    const issues = [];
    const title = String(options.title ?? "");
    if (!title.trim()) issues.push({ level: "error" as const, message: "YouTube needs a video title." });
    if (title.length > 100) issues.push({ level: "error" as const, message: "Title is capped at 100 characters." });
    if (!media.some((m) => m.kind === "video")) issues.push({ level: "error" as const, message: "Attach the video file." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open YouTube Studio for ${ctx.channel.handle}` },
    { label: "Upload the video", detail: ctx.media[0]?.originalName },
    { label: "Set the title", copy: String(ctx.options.title ?? "") },
    { label: "Paste the description", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.google.com/youtube/v3/docs/videos/insert",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    requiresAppReview: true,
    notes:
      "youtube.upload is a restricted scope: until Google audits the project, uploads are locked to private and only test users can authorise.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("YouTube", "missing access token");
    const video = ctx.media.find((m) => m.kind === "video");
    if (!video) throw new Error("Attach a video file.");

    const metadata = {
      snippet: {
        title: String(ctx.options.title ?? ctx.post.title ?? "Untitled"),
        description: ctx.body,
        tags: String(ctx.options.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        categoryId: String(ctx.options.categoryId ?? "22"),
      },
      status: {
        privacyStatus: String(ctx.options.privacy ?? "public"),
        selfDeclaredMadeForKids: Boolean(ctx.options.madeForKids),
      },
    };

    // Resumable upload: start a session, then stream the file to the returned URL.
    const start = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": video.mimeType,
        "X-Upload-Content-Length": String(video.size),
      },
      body: JSON.stringify(metadata),
    });
    if (!start.ok) throw new Error(`YouTube upload session failed (${start.status}): ${(await start.text()).slice(0, 300)}`);
    const sessionUrl = start.headers.get("location");
    if (!sessionUrl) throw new Error("YouTube did not return an upload session URL.");

    const file = await fetch(ctx.publicUrl(video)).then((r) => r.arrayBuffer());
    const done = await apiFetch(sessionUrl, {
      label: "YouTube upload",
      method: "PUT",
      headers: { "Content-Type": video.mimeType, "Content-Length": String(file.byteLength) },
      body: file,
    });
    const id = String(done.id);
    return { externalId: id, externalUrl: `https://www.youtube.com/watch?v=${id}` };
  },
  fetchMetrics: async ({ externalPostId, credentials }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("YouTube", "missing access token");
    const res = await apiFetch(`${API}/videos?part=statistics&id=${externalPostId}`, {
      label: "YouTube statistics",
      headers: { Authorization: `Bearer ${token}` },
    });
    const s = ((res.items as { statistics: Record<string, string> }[]) ?? [])[0]?.statistics ?? {};
    return {
      videoViews: Number(s.viewCount ?? 0), likes: Number(s.likeCount ?? 0),
      commentCount: Number(s.commentCount ?? 0), raw: res,
    };
  },
};
