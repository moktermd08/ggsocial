import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.pinterest.com/v5";

export const pinterest: Platform = {
  id: "pinterest",
  name: "Pinterest",
  color: "#E60023",
  category: "social",
  blurb: "Image and video Pins saved to a board, with a destination link.",
  constraints: {
    textMax: 800,
    mediaMin: 1,
    mediaMax: 1,
    allowedMedia: ["image", "video"],
    requiresMedia: true,
    supportsLinks: true,
    hashtagsUseful: false,
    aspectRatioHint: "2:3",
  },
  optionFields: [
    { key: "boardId", label: "Board ID", type: "text", required: true, help: "Set a default per channel in Channel settings." },
    { key: "title", label: "Pin title", type: "text", help: "Max 100 characters." },
    { key: "link", label: "Destination link", type: "text", placeholder: "https://…" },
    { key: "altText", label: "Alt text", type: "text" },
  ],
  validate: ({ media, options }) => {
    const issues = [];
    if (!options.boardId) issues.push({ level: "error" as const, message: "Choose a board for this Pin." });
    if (media.length !== 1) issues.push({ level: "error" as const, message: "A Pin needs exactly one image or video." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open Pinterest as ${ctx.channel.handle}` },
    { label: "Create a Pin and upload the media" },
    { label: "Title", copy: String(ctx.options.title ?? ctx.post.title) },
    { label: "Description", copy: ctx.body },
    ...(ctx.options.link ? [{ label: "Destination link", copy: String(ctx.options.link) }] : []),
  ],
  liveSetup: {
    docsUrl: "https://developers.pinterest.com/docs/api/v5/pins-create/",
    envKeys: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
    requiresAppReview: true,
    notes: "Trial access works against your own account; standard access needs Pinterest's app review.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Pinterest", "missing access token");
    const boardId = String(ctx.options.boardId ?? (ctx.channel.settings as Record<string, unknown>)?.boardId ?? "");
    if (!boardId) throw new Error("No Pinterest board selected.");
    const m = ctx.media[0];

    const res = await apiFetch(`${API}/pins`, {
      label: "Pinterest pin",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        board_id: boardId,
        title: String(ctx.options.title ?? ctx.post.title ?? "").slice(0, 100) || undefined,
        description: ctx.body,
        link: ctx.options.link ? String(ctx.options.link) : undefined,
        alt_text: ctx.options.altText ? String(ctx.options.altText) : m.altText ?? undefined,
        media_source: m.kind === "video"
          ? { source_type: "video_id", cover_image_url: undefined, media_id: undefined }
          : { source_type: "image_url", url: ctx.publicUrl(m) },
      }),
    });
    const id = String(res.id);
    return { externalId: id, externalUrl: `https://www.pinterest.com/pin/${id}/` };
  },
};
