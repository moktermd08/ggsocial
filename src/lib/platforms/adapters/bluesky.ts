import { apiFetch, fetchMediaBytes, NotConnectedError, type InboundItem, type Platform } from "../types";

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

type Session = { host: string; jwt: string; did: string; handle: string };

/** Signs in with the stored handle and app password. Reads go through the PDS, which proxies app.bsky.* to the AppView. */
async function signIn(
  channel: { externalId: string | null; handle: string; settings: unknown },
  credentials: Record<string, string> | null,
): Promise<Session> {
  const identifier = channel.externalId || channel.handle.replace(/^@/, "");
  const password = credentials?.accessToken;
  if (!identifier || !password) throw new NotConnectedError("Bluesky", "missing handle or app password");
  const host = service({ channel, options: {} });
  const session = await apiFetch(`${host}/xrpc/com.atproto.server.createSession`, {
    label: "Bluesky session", method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  return { host, jwt: String(session.accessJwt), did: String(session.did), handle: String(session.handle ?? identifier) };
}

type RecordRef = { uri: string; cid: string };
type BskyPost = { uri: string; cid: string; likeCount?: number; replyCount?: number; repostCount?: number; quoteCount?: number; record?: { reply?: { root?: RecordRef } } };

async function getPost(sess: Session, uri: string): Promise<BskyPost> {
  const res = await apiFetch(`${sess.host}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, {
    label: "Bluesky post lookup", headers: { Authorization: `Bearer ${sess.jwt}` },
  });
  const post = ((res.posts as BskyPost[] | undefined) ?? [])[0];
  if (!post) throw new Error("Bluesky post lookup found nothing: it may have been deleted.");
  return post;
}

const postUrl = (handle: string, uri: string) => `https://bsky.app/profile/${handle}/post/${uri.split("/").pop()}`;

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
  fetchAccountStats: async ({ channel, credentials }) => {
    const identifier = channel.externalId || channel.handle.replace(/^@/, "");
    const password = credentials?.accessToken;
    if (!identifier || !password) throw new NotConnectedError("Bluesky", "missing handle or app password");
    const host = service({ channel, options: {} });

    const session = await apiFetch(`${host}/xrpc/com.atproto.server.createSession`, {
      label: "Bluesky session",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    // The PDS proxies app.bsky.* reads to the AppView for the session's account.
    const res = await apiFetch(`${host}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(String(session.did))}`, {
      label: "Bluesky account stats",
      headers: { Authorization: `Bearer ${String(session.accessJwt)}` },
    });
    return res.followersCount != null ? { followers: Number(res.followersCount) } : {};
  },
  fetchMetrics: async ({ channel, externalPostId, credentials }) => {
    const sess = await signIn(channel, credentials);
    const post = await getPost(sess, externalPostId);
    // Bluesky does not report impressions or reach, so only the public counts are filled in.
    return {
      likes: post.likeCount ?? 0, commentCount: post.replyCount ?? 0,
      shares: (post.repostCount ?? 0) + (post.quoteCount ?? 0), raw: post as unknown as Record<string, unknown>,
    };
  },
  fetchInbound: async ({ channel, credentials, since, posts }) => {
    const sess = await signIn(channel, credentials);
    const res = await apiFetch(`${sess.host}/xrpc/app.bsky.notification.listNotifications?limit=50`, {
      label: "Bluesky notifications", headers: { Authorization: `Bearer ${sess.jwt}` },
    });
    type Note = {
      uri: string; reason: string; indexedAt: string;
      author: { did: string; handle: string; displayName?: string };
      record?: { text?: string; reply?: { root?: RecordRef; parent?: RecordRef } };
    };
    const ours = new Set(posts);
    const items: InboundItem[] = [];
    for (const n of (res.notifications as Note[] | undefined) ?? []) {
      const at = new Date(n.indexedAt);
      if (at <= since) break;
      if (!["reply", "mention", "quote"].includes(n.reason) || n.author.did === sess.did) continue;
      const text = n.record?.text ?? "";
      if (!text.trim()) continue;
      const parent = n.record?.reply?.parent?.uri;
      const root = n.record?.reply?.root?.uri;
      items.push({
        externalId: n.uri, kind: n.reason === "reply" ? "comment" : "mention", body: text, receivedAt: at,
        externalPostId: (parent && ours.has(parent) ? parent : root && ours.has(root) ? root : null),
        authorName: n.author.displayName || n.author.handle, authorHandle: `@${n.author.handle}`,
        authorUrl: `https://bsky.app/profile/${n.author.handle}`, externalUrl: postUrl(n.author.handle, n.uri),
      });
    }
    return items;
  },
  sendReply: async ({ channel, credentials, replyTo, body }) => {
    if (graphemes(body) > 300) throw new Error(`Bluesky reply is ${graphemes(body)} graphemes: the limit is 300.`);
    const sess = await signIn(channel, credentials);
    const target = await getPost(sess, replyTo);
    const parent = { uri: target.uri, cid: target.cid };
    const { facets } = linkFacets(body);
    const res = await apiFetch(`${sess.host}/xrpc/com.atproto.repo.createRecord`, {
      label: "Bluesky reply", method: "POST",
      headers: { Authorization: `Bearer ${sess.jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: sess.did, collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post", text: body, createdAt: new Date().toISOString(),
          reply: { root: target.record?.reply?.root ?? parent, parent },
          ...(facets ? { facets } : {}),
        },
      }),
    });
    const uri = String(res.uri);
    return { externalId: uri, externalUrl: postUrl(sess.handle, uri) };
  },
};
