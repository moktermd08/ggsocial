import { apiFetch, fetchMediaBytes, NotConnectedError, type InboundItem, type Platform } from "../types";

function host(ctx: { channel: { settings: unknown }; options: Record<string, unknown> }) {
  const s = (ctx.channel.settings ?? {}) as Record<string, unknown>;
  const raw = String(ctx.options.instance ?? s.instance ?? "https://mastodon.social");
  return (raw.startsWith("http") ? raw : `https://${raw}`).replace(/\/$/, "");
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

/** A status's HTML as plain text, without the @mention of the account it was sent to. */
export function statusText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n").replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTITIES[e])
    .replace(/^(?:@\S+\s*)+/, "").trim();
}

type MastoStatus = { id: string; url?: string; content: string; visibility: string; in_reply_to_id?: string | null; account: { id: string; acct: string; display_name?: string; url?: string } };

const scopeHint = (err: unknown) =>
  err instanceof Error && /\((?:401|403)\)/.test(err.message)
    ? new Error("Mastodon refused the request. The access token needs the read:notifications and read:statuses scopes: create it again with them.")
    : err;

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
    notes: "Instance settings → Development → New application. Scopes: write:statuses, write:media, read:accounts (follower counts), read:notifications and read:statuses (replies, mentions and post counts). Paste the access token here — most instances never expire it.",
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
  fetchAccountStats: async ({ channel, credentials }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("Mastodon", "missing access token");
    const res = await apiFetch(`${host({ channel, options: {} })}/api/v1/accounts/verify_credentials`, {
      label: "Mastodon account stats",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.followers_count != null ? { followers: Number(res.followers_count) } : {};
  },
  fetchMetrics: async ({ channel, externalPostId, credentials }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("Mastodon", "missing access token");
    const res = await apiFetch(`${host({ channel, options: {} })}/api/v1/statuses/${encodeURIComponent(externalPostId)}`, {
      label: "Mastodon status metrics", headers: { Authorization: `Bearer ${token}` },
    });
    // Mastodon does not report impressions or reach.
    return { likes: Number(res.favourites_count ?? 0), commentCount: Number(res.replies_count ?? 0), shares: Number(res.reblogs_count ?? 0), raw: res };
  },
  fetchInbound: async ({ channel, credentials, since, posts }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("Mastodon", "missing access token");
    const base = host({ channel, options: {} });
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const me = await apiFetch(`${base}/api/v1/accounts/verify_credentials`, { label: "Mastodon account", headers });
      // A reply to the brand's post arrives as a mention, as does a direct message.
      const res = (await apiFetch(`${base}/api/v1/notifications?types[]=mention&limit=40`, { label: "Mastodon notifications", headers })) as unknown;
      const list = (Array.isArray(res) ? res : []) as Array<{ type: string; created_at: string; account: MastoStatus["account"]; status?: MastoStatus }>;
      const ours = new Set(posts);
      const items: InboundItem[] = [];
      for (const n of list) {
        const at = new Date(n.created_at);
        if (at <= since) break;
        const st = n.status;
        if (!st || n.account.id === String(me.id)) continue;
        const text = statusText(st.content);
        if (!text) continue;
        const replyTo = st.in_reply_to_id ?? null;
        items.push({
          externalId: st.id, receivedAt: at, body: text,
          kind: st.visibility === "direct" ? "message" : replyTo && ours.has(replyTo) ? "comment" : "mention",
          externalPostId: replyTo && ours.has(replyTo) ? replyTo : null,
          authorName: n.account.display_name || n.account.acct, authorHandle: `@${n.account.acct}`,
          authorUrl: n.account.url ?? null, externalUrl: st.url ?? null,
        });
      }
      return items;
    } catch (err) {
      throw scopeHint(err);
    }
  },
  sendReply: async ({ channel, credentials, replyTo, body }) => {
    const token = credentials?.accessToken;
    if (!token) throw new NotConnectedError("Mastodon", "missing access token");
    const base = host({ channel, options: {} });
    const headers = { Authorization: `Bearer ${token}` };
    const original = (await apiFetch(`${base}/api/v1/statuses/${encodeURIComponent(replyTo)}`, { label: "Mastodon status", headers })) as unknown as MastoStatus;
    // The reply only notifies the person if their @name is in the text.
    const mention = `@${original.account.acct}`;
    const status = body.trimStart().startsWith(mention) ? body : `${mention} ${body}`;
    if (status.length > 500) throw new Error(`Mastodon reply is ${status.length} characters with the @mention: the limit is 500.`);
    const res = await apiFetch(`${base}/api/v1/statuses`, {
      label: "Mastodon reply", method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": `reply-${replyTo}` },
      // Same audience as the message being answered: a direct message stays direct.
      body: JSON.stringify({ status, in_reply_to_id: replyTo, visibility: original.visibility }),
    });
    return { externalId: String(res.id), externalUrl: String(res.url ?? "") };
  },
};
