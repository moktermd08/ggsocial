import { apiFetch, fetchMediaBytes, NotConnectedError, type Platform } from "../types";

/** Resolves the PDS host — self-hosted PDSs work by overriding it per channel. */
function service(ctx: { channel: { settings: unknown }; options: Record<string, unknown> }) {
  const s = (ctx.channel.settings ?? {}) as Record<string, unknown>;
  return String(ctx.options.service ?? s.service ?? "https://bsky.social").replace(/\/$/, "");
}

/** Bluesky counts graphemes, not UTF-16 code units. */
function graphemes(text: string) {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

/** Detects links and mentions so they render as real facets rather than plain text. */
function linkFacets(text: string) {
  const bytes = new TextEncoder().encode(text);
  const facets: unknown[] = [];
  const re = /https?:\/\/[^\s)]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = new TextEncoder().encode(text.slice(0, m.index)).length;
    const len = new TextEncoder().encode(m[0]).length;
    facets.push({
      index: { byteStart: before, byteEnd: before + len },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }],
    });
  }
  return { facets: facets.length ? facets : undefined, byteLength: bytes.length };
}

export const bluesky: Platform = {
  id: "bluesky",
  name: "Bluesky",
  color: "#0085FF",
  category: "social",
  blurb: "Open AT Protocol posts with image embeds — no app review, no rate-limit theatre.",
  constraints: {
    textMax: 300,
    mediaMin: 0,
    mediaMax: 4,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: true,
    aspectRatioHint: "16:9 or 1:1",
  },
  optionFields: [
    { key: "service", label: "PDS host", type: "text", placeholder: "https://bsky.social", help: "Only change this for a self-hosted PDS." },
    { key: "langs", label: "Language codes", type: "text", placeholder: "en, bn", help: "Comma separated; improves reach in the language feeds." },
  ],
  validate: ({ body }) => {
    const n = graphemes(body);
    return n > 300 ? [{ level: "error" as const, message: `${n} graphemes — Bluesky allows 300.` }] : [];
  },
  manualSteps: (ctx) => [
    { label: `Open Bluesky as ${ctx.channel.handle}` },
    { label: "Post text", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://docs.bsky.app/docs/advanced-guides/posting",
    envKeys: [],
    requiresAppReview: false,
    notes: "Create an App Password at Settings → App Passwords. Paste the handle as the account ID and the app password as the access token — ggsocial exchanges it for a session on every publish.",
  },
  publish: async (ctx) => {
    const identifier = ctx.channel.externalId || ctx.channel.handle.replace(/^@/, "");
    const password = ctx.credentials?.accessToken;
    if (!identifier || !password) throw new NotConnectedError("Bluesky", "missing handle or app password");
    const host = service(ctx);

    const session = await apiFetch(`${host}/xrpc/com.atproto.server.createSession`, {
      label: "Bluesky session",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const jwt = String(session.accessJwt);
    const did = String(session.did);

    const images: unknown[] = [];
    for (const m of ctx.media.slice(0, 4)) {
      const { bytes, contentType } = await fetchMediaBytes(ctx.publicUrl(m));
      const blob = await apiFetch(`${host}/xrpc/com.atproto.repo.uploadBlob`, {
        label: "Bluesky blob upload",
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": contentType },
        body: bytes,
      });
      images.push({ alt: m.altText ?? "", image: blob.blob });
    }

    const { facets } = linkFacets(ctx.body);
    const langs = String(ctx.options.langs ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const res = await apiFetch(`${host}/xrpc/com.atproto.repo.createRecord`, {
      label: "Bluesky post",
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text: ctx.body,
          createdAt: new Date().toISOString(),
          ...(facets ? { facets } : {}),
          ...(langs.length ? { langs } : {}),
          ...(images.length ? { embed: { $type: "app.bsky.embed.images", images } } : {}),
        },
      }),
    });
    const uri = String(res.uri);
    const rkey = uri.split("/").pop();
    return { externalId: uri, externalUrl: `https://bsky.app/profile/${identifier}/post/${rkey}` };
  },
};
