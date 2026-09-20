import { apiFetch, NotConnectedError, type Platform } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

export const instagram: Platform = {
  id: "instagram",
  name: "Instagram",
  color: "#E1306C",
  category: "social",
  blurb: "Feed posts, carousels, reels and stories for an Instagram Business or Creator account.",
  constraints: {
    textMax: 2200,
    mediaMin: 1,
    mediaMax: 10,
    allowedMedia: ["image", "video"],
    videoMaxSeconds: 900,
    requiresMedia: true,
    supportsFirstComment: true,
    supportsLinks: false,
    hashtagsUseful: true,
    aspectRatioHint: "4:5 feed, 9:16 reels/stories",
  },
  optionFields: [
    {
      key: "format",
      label: "Format",
      type: "select",
      defaultValue: "feed",
      choices: [
        { value: "feed", label: "Feed post / carousel" },
        { value: "reel", label: "Reel" },
        { value: "story", label: "Story" },
      ],
    },
    { key: "coverUrl", label: "Reel cover image URL", type: "text", help: "Optional. Reels only." },
    { key: "locationId", label: "Location ID", type: "text", help: "Optional Facebook Page location id." },
  ],
  validate: ({ body, media, options }) => {
    const issues = [];
    if (options.format === "reel" && media.some((m) => m.kind !== "video")) {
      issues.push({ level: "error" as const, message: "Reels need a single video file." });
    }
    if (options.format === "story" && media.length > 1) {
      issues.push({ level: "error" as const, message: "One media item per story." });
    }
    if (/https?:\/\//.test(body)) {
      issues.push({ level: "warn" as const, message: "Links in Instagram captions are not clickable — use the bio link." });
    }
    if (media.length > 1 && media.some((m) => m.kind === "video") && media.some((m) => m.kind === "image")) {
      issues.push({ level: "warn" as const, message: "Mixed image/video carousels render inconsistently." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open Instagram as " + ctx.channel.handle, detail: "App or Meta Business Suite." },
    { label: "Upload the media below in order", detail: `${ctx.media.length} file(s)` },
    { label: "Paste the caption", copy: ctx.body },
    ...(ctx.firstComment ? [{ label: "Post the first comment", copy: ctx.firstComment }] : []),
  ],
  liveSetup: {
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    envKeys: ["META_APP_ID", "META_APP_SECRET"],
    requiresAppReview: true,
    notes:
      "Needs an Instagram Business account linked to a Facebook Page, a Meta app with instagram_content_publish + pages_show_list, and App Review. Media must be reachable at a public HTTPS URL.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    const igUserId = ctx.channel.externalId;
    if (!token || !igUserId) {
      throw new NotConnectedError("Instagram", "missing access token or Instagram user id");
    }
    const format = (ctx.options.format as string) ?? "feed";
    const isCarousel = ctx.media.length > 1 && format === "feed";

    const createContainer = async (params: Record<string, string>) =>
      apiFetch(`${GRAPH}/${igUserId}/media`, {
        label: "Instagram media container",
        method: "POST",
        body: new URLSearchParams({ ...params, access_token: token }),
      });

    let creationId: string;
    if (isCarousel) {
      const children: string[] = [];
      for (const m of ctx.media) {
        const child = await createContainer({
          is_carousel_item: "true",
          ...(m.kind === "video" ? { media_type: "VIDEO", video_url: ctx.publicUrl(m) } : { image_url: ctx.publicUrl(m) }),
        });
        children.push(String(child.id));
      }
      const parent = await createContainer({ media_type: "CAROUSEL", children: children.join(","), caption: ctx.body });
      creationId = String(parent.id);
    } else {
      const m = ctx.media[0];
      const mediaType = format === "reel" ? "REELS" : format === "story" ? "STORIES" : m.kind === "video" ? "VIDEO" : "IMAGE";
      const container = await createContainer({
        media_type: mediaType,
        ...(m.kind === "video" ? { video_url: ctx.publicUrl(m) } : { image_url: ctx.publicUrl(m) }),
        ...(format === "story" ? {} : { caption: ctx.body }),
        ...(ctx.options.coverUrl ? { cover_url: String(ctx.options.coverUrl) } : {}),
      });
      creationId = String(container.id);
    }

    // Video containers are processed asynchronously; poll until FINISHED.
    for (let i = 0; i < 30; i++) {
      const status = await apiFetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${token}`, {
        label: "Instagram container status",
      });
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR") throw new Error("Instagram rejected the media during processing.");
      await new Promise((r) => setTimeout(r, 4000));
    }

    const published = await apiFetch(`${GRAPH}/${igUserId}/media_publish`, {
      label: "Instagram publish",
      method: "POST",
      body: new URLSearchParams({ creation_id: creationId, access_token: token }),
    });
    const id = String(published.id);

    if (ctx.firstComment) {
      await apiFetch(`${GRAPH}/${id}/comments`, {
        label: "Instagram first comment",
        method: "POST",
        body: new URLSearchParams({ message: ctx.firstComment, access_token: token }),
      });
    }
    return { externalId: id, externalUrl: `https://www.instagram.com/p/${id}` };
  },
  fetchMetrics: async ({ externalPostId, credentials }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("Instagram", "missing access token");
    const res = await apiFetch(
      `${GRAPH}/${externalPostId}/insights?metric=impressions,reach,likes,comments,saved,shares&access_token=${token}`,
      { label: "Instagram insights" },
    );
    const byName = Object.fromEntries(
      ((res.data as { name: string; values: { value: number }[] }[]) ?? []).map((d) => [d.name, d.values?.[0]?.value ?? 0]),
    );
    return {
      impressions: byName.impressions, reach: byName.reach, likes: byName.likes,
      commentCount: byName.comments, saves: byName.saved, shares: byName.shares, raw: res,
    };
  },
};
