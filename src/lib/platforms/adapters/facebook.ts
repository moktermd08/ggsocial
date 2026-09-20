import { apiFetch, NotConnectedError, type Platform } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

export const facebook: Platform = {
  id: "facebook",
  name: "Facebook Page",
  color: "#1877F2",
  category: "social",
  blurb: "Text, link, photo and video posts to a Facebook Page you administer.",
  constraints: {
    textMax: 63206,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image", "video"],
    supportsFirstComment: true,
    supportsLinks: true,
    hashtagsUseful: false,
    aspectRatioHint: "1.91:1 links, 4:5 photos",
  },
  optionFields: [
    { key: "link", label: "Link to attach", type: "text", placeholder: "https://…", help: "Renders a link preview when no media is attached." },
    { key: "published", label: "Publish immediately (off = Page draft)", type: "boolean", defaultValue: true },
  ],
  validate: ({ body, media, options }) => {
    const issues = [];
    if (!body.trim() && media.length === 0 && !options.link) {
      issues.push({ level: "error" as const, message: "Add copy, media or a link." });
    }
    if (media.length > 0 && options.link) {
      issues.push({ level: "warn" as const, message: "With media attached, Facebook ignores the link preview." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open the ${ctx.channel.handle} Page in Meta Business Suite` },
    { label: "Paste the copy", copy: ctx.body },
    ...(ctx.media.length ? [{ label: `Attach ${ctx.media.length} file(s)` }] : []),
    ...(ctx.options.link ? [{ label: "Add the link", copy: String(ctx.options.link) }] : []),
  ],
  liveSetup: {
    docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
    envKeys: ["META_APP_ID", "META_APP_SECRET"],
    requiresAppReview: true,
    notes: "Needs a Meta app with pages_manage_posts + pages_read_engagement and a long-lived Page access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    const pageId = ctx.channel.externalId;
    if (!token || !pageId) throw new NotConnectedError("Facebook", "missing Page access token or Page id");

    const published = ctx.options.published !== false;
    let result: Record<string, unknown>;

    if (ctx.media.length === 1 && ctx.media[0].kind === "image") {
      result = await apiFetch(`${GRAPH}/${pageId}/photos`, {
        label: "Facebook photo post",
        method: "POST",
        body: new URLSearchParams({ url: ctx.publicUrl(ctx.media[0]), caption: ctx.body, published: String(published), access_token: token }),
      });
    } else if (ctx.media.length === 1 && ctx.media[0].kind === "video") {
      result = await apiFetch(`${GRAPH}/${pageId}/videos`, {
        label: "Facebook video post",
        method: "POST",
        body: new URLSearchParams({ file_url: ctx.publicUrl(ctx.media[0]), description: ctx.body, access_token: token }),
      });
    } else if (ctx.media.length > 1) {
      // Unpublished photos first, then one feed post referencing them all.
      const ids: string[] = [];
      for (const m of ctx.media) {
        const photo = await apiFetch(`${GRAPH}/${pageId}/photos`, {
          label: "Facebook photo upload",
          method: "POST",
          body: new URLSearchParams({ url: ctx.publicUrl(m), published: "false", access_token: token }),
        });
        ids.push(String(photo.id));
      }
      const params = new URLSearchParams({ message: ctx.body, published: String(published), access_token: token });
      ids.forEach((id, i) => params.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
      result = await apiFetch(`${GRAPH}/${pageId}/feed`, { label: "Facebook multi-photo post", method: "POST", body: params });
    } else {
      result = await apiFetch(`${GRAPH}/${pageId}/feed`, {
        label: "Facebook post",
        method: "POST",
        body: new URLSearchParams({
          message: ctx.body,
          ...(ctx.options.link ? { link: String(ctx.options.link) } : {}),
          published: String(published),
          access_token: token,
        }),
      });
    }

    const id = String(result.post_id ?? result.id);
    if (ctx.firstComment) {
      await apiFetch(`${GRAPH}/${id}/comments`, {
        label: "Facebook first comment",
        method: "POST",
        body: new URLSearchParams({ message: ctx.firstComment, access_token: token }),
      });
    }
    return { externalId: id, externalUrl: `https://www.facebook.com/${id}` };
  },
  fetchMetrics: async ({ externalPostId, credentials }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("Facebook", "missing access token");
    const res = await apiFetch(
      `${GRAPH}/${externalPostId}/insights?metric=post_impressions,post_impressions_unique,post_clicks,post_reactions_by_type_total&access_token=${token}`,
      { label: "Facebook insights" },
    );
    const byName = Object.fromEntries(
      ((res.data as { name: string; values: { value: number }[] }[]) ?? []).map((d) => [d.name, d.values?.[0]?.value ?? 0]),
    );
    return { impressions: byName.post_impressions, reach: byName.post_impressions_unique, clicks: byName.post_clicks, raw: res };
  },
};
