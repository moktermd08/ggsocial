import { apiFetch, fetchMediaBytes, NotConnectedError, type Platform } from "../types";

function host(ctx: { channel: { settings: unknown }; options: Record<string, unknown> }) {
  const s = (ctx.channel.settings ?? {}) as Record<string, unknown>;
  const raw = String(ctx.options.instance ?? s.instance ?? "https://mastodon.social");
  return (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
}

export const mastodon: Platform = {
  id: "mastodon",
  name: "Mastodon",
  color: "#6364FF",
  category: "social",
  blurb: "Fediverse posts to any instance — tokens are issued instantly, no review.",
  constraints: {
    textMax: 500,
    mediaMin: 0,
    mediaMax: 4,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "instance", label: "Instance URL", type: "text", placeholder: "https://mastodon.social", required: true },
    { key: "visibility", label: "Visibility", type: "select", defaultValue: "public",
      choices: [
        { value: "public", label: "Public" },
        { value: "unlisted", label: "Unlisted" },
        { value: "private", label: "Followers only" },
      ] },
    { key: "spoilerText", label: "Content warning", type: "text", help: "Leave blank for none." },
    { key: "sensitive", label: "Mark media sensitive", type: "boolean", defaultValue: false },
  ],
  manualSteps: (ctx) => [
    { label: `Open ${String(ctx.options.instance ?? "your instance")} as ${ctx.channel.handle}` },
    { label: "Toot", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://docs.joinmastodon.org/methods/statuses/",
    envKeys: [],
    requiresAppReview: false,
    notes: "Instance settings → Development → New application. Scopes: write:statuses, write:media. Paste the access token here — most instances never expire it.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Mastodon", "missing access token");
    const base = host(ctx);

    const mediaIds: string[] = [];
    for (const m of ctx.media.slice(0, 4)) {
      const { bytes, contentType } = await fetchMediaBytes(ctx.publicUrl(m));
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: contentType }), m.originalName);
      if (m.altText) form.append("description", m.altText);
      const up = await apiFetch(`${base}/api/v2/media`, {
        label: "Mastodon media",
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      mediaIds.push(String(up.id));
    }

    const res = await apiFetch(`${base}/api/v1/statuses`, {
      label: "Mastodon status",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Stops a retried publish from duplicating the toot.
        "Idempotency-Key": ctx.target.id,
      },
      body: JSON.stringify({
        status: ctx.body,
        visibility: String(ctx.options.visibility ?? "public"),
        sensitive: Boolean(ctx.options.sensitive),
        spoiler_text: ctx.options.spoilerText ? String(ctx.options.spoilerText) : undefined,
        media_ids: mediaIds.length ? mediaIds : undefined,
      }),
    });
    return { externalId: String(res.id), externalUrl: String(res.url ?? "") };
  },
};
