import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bluesky } from "@/lib/platforms/adapters/bluesky";
import { mastodon, statusText } from "@/lib/platforms/adapters/mastodon";
import { NotConnectedError } from "@/lib/platforms/types";

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let routes: Array<[RegExp, (call: Call) => unknown | Response]>;

beforeEach(() => {
  calls = [];
  routes = [];
  vi.stubGlobal("fetch", vi.fn(async (u: URL | string, init?: RequestInit) => {
    const call = { url: String(u), init };
    calls.push(call);
    const route = routes.find(([re]) => re.test(call.url));
    if (!route) return new Response("no route", { status: 404 });
    const out = route[1](call);
    return out instanceof Response ? out : new Response(JSON.stringify(out));
  }));
});
afterEach(() => vi.unstubAllGlobals());
const on = (re: RegExp, fn: (c: Call) => unknown | Response) => routes.push([re, fn]);
const body = (c: Call) => JSON.parse(String(c.init?.body));

const T0 = new Date("2026-10-10T08:00:00Z");
const iso = (mins: number) => new Date(T0.getTime() + mins * 60_000).toISOString();

describe("Bluesky", () => {
  const channel = { id: "c", externalId: "brand.bsky.social", handle: "@brand.bsky.social", settings: {} } as never;
  const credentials = { accessToken: "app-pass" };
  beforeEach(() => on(/createSession/, () => ({ accessJwt: "jwt", did: "did:plc:me", handle: "brand.bsky.social" })));

  it("reads replies and mentions, links replies to our posts, and skips our own, old and unrelated ones", async () => {
    const ours = "at://did:plc:me/app.bsky.feed.post/aaa";
    on(/listNotifications/, () => ({
      notifications: [
        { uri: "at://did:plc:u1/app.bsky.feed.post/r1", reason: "reply", indexedAt: iso(30), author: { did: "did:plc:u1", handle: "ann.test", displayName: "Ann" },
          record: { text: "Love this", reply: { root: { uri: ours, cid: "c1" }, parent: { uri: ours, cid: "c1" } } } },
        { uri: "at://did:plc:u2/app.bsky.feed.post/r2", reason: "reply", indexedAt: iso(25), author: { did: "did:plc:u2", handle: "bob.test" },
          record: { text: "Nested", reply: { root: { uri: ours, cid: "c1" }, parent: { uri: "at://did:plc:u1/app.bsky.feed.post/r1", cid: "c9" } } } },
        { uri: "at://did:plc:u3/app.bsky.feed.post/m1", reason: "mention", indexedAt: iso(20), author: { did: "did:plc:u3", handle: "cy.test" }, record: { text: "@brand thoughts?" } },
        { uri: "at://x/like", reason: "like", indexedAt: iso(19), author: { did: "did:plc:u4", handle: "d.test" }, record: {} },
        { uri: "at://did:plc:me/app.bsky.feed.post/self", reason: "reply", indexedAt: iso(18), author: { did: "did:plc:me", handle: "brand.bsky.social" }, record: { text: "our own reply" } },
        { uri: "at://did:plc:u5/app.bsky.feed.post/old", reason: "reply", indexedAt: iso(-10), author: { did: "did:plc:u5", handle: "old.test" }, record: { text: "too old" } },
        { uri: "at://did:plc:u6/app.bsky.feed.post/never", reason: "reply", indexedAt: iso(-20), author: { did: "did:plc:u6", handle: "older.test" }, record: { text: "after the cutoff" } },
      ],
    }));
    const items = await bluesky.fetchInbound!({ channel, credentials, since: T0, posts: [ours] });
    expect(items.map((i) => [i.body, i.kind, i.externalPostId])).toEqual([
      ["Love this", "comment", ours],
      ["Nested", "comment", ours],
      ["@brand thoughts?", "mention", null],
    ]);
    expect(items[0]).toMatchObject({ authorName: "Ann", authorHandle: "@ann.test", externalUrl: "https://bsky.app/profile/ann.test/post/r1" });
    expect(items[1].authorName).toBe("bob.test");
  });

  it("replies in the thread, using the root of the comment being answered", async () => {
    const comment = "at://did:plc:u1/app.bsky.feed.post/r1";
    on(/getPosts/, () => ({ posts: [{ uri: comment, cid: "cid-r1", record: { reply: { root: { uri: "at://did:plc:me/app.bsky.feed.post/aaa", cid: "cid-root" } } } }] }));
    on(/createRecord/, () => ({ uri: "at://did:plc:me/app.bsky.feed.post/new1" }));
    const out = await bluesky.sendReply!({ channel, credentials, replyTo: comment, body: "Thanks Ann! See https://x.test/p" });
    expect(out).toEqual({ externalId: "at://did:plc:me/app.bsky.feed.post/new1", externalUrl: "https://bsky.app/profile/brand.bsky.social/post/new1" });
    const rec = body(calls.find((c) => /createRecord/.test(c.url))!).record;
    expect(rec.reply).toEqual({
      root: { uri: "at://did:plc:me/app.bsky.feed.post/aaa", cid: "cid-root" },
      parent: { uri: comment, cid: "cid-r1" },
    });
    expect(rec.facets).toHaveLength(1);
  });

  it("makes the comment its own root when it starts the thread", async () => {
    const comment = "at://did:plc:u1/app.bsky.feed.post/top";
    on(/getPosts/, () => ({ posts: [{ uri: comment, cid: "cid-top", record: {} }] }));
    on(/createRecord/, () => ({ uri: "at://did:plc:me/app.bsky.feed.post/n" }));
    await bluesky.sendReply!({ channel, credentials, replyTo: comment, body: "hi" });
    const rec = body(calls.find((c) => /createRecord/.test(c.url))!).record;
    expect(rec.reply.root).toEqual({ uri: comment, cid: "cid-top" });
  });

  it("refuses an over-long reply without calling the network", async () => {
    await expect(bluesky.sendReply!({ channel, credentials, replyTo: "at://x", body: "a".repeat(301) })).rejects.toThrow(/300/);
    expect(calls).toHaveLength(0);
  });

  it("explains a reply to a deleted comment", async () => {
    on(/getPosts/, () => ({ posts: [] }));
    await expect(bluesky.sendReply!({ channel, credentials, replyTo: "at://gone", body: "hi" })).rejects.toThrow(/deleted/);
  });

  it("reports likes, replies and reposts plus quotes, with no reach", async () => {
    on(/getPosts/, () => ({ posts: [{ uri: "at://p", cid: "c", likeCount: 12, replyCount: 3, repostCount: 4, quoteCount: 2 }] }));
    const m = await bluesky.fetchMetrics!({ channel, externalPostId: "at://p", credentials });
    expect(m).toMatchObject({ likes: 12, commentCount: 3, shares: 6 });
    expect(m.reach).toBeUndefined();
  });

  it("needs a handle and app password", async () => {
    await expect(bluesky.fetchInbound!({ channel, credentials: null, since: T0, posts: [] })).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe("Mastodon", () => {
  const channel = { id: "c", handle: "@brand", settings: { instance: "https://masto.test" } } as never;
  const credentials = { accessToken: "tok" };

  it("turns status HTML into plain text without the leading @mention", () => {
    expect(statusText('<p><span class="h-card"><a href="https://masto.test/@brand">@<span>brand</span></a></span> Thanks &amp; hello<br />second line</p>'))
      .toBe("Thanks & hello\nsecond line");
    expect(statusText("<p>a</p><p>b &lt;3</p>")).toBe("a\n\nb <3");
  });

  it("reads replies, mentions and direct messages, and skips our own and old ones", async () => {
    on(/verify_credentials/, () => ({ id: "me" }));
    const acct = (id: string, name: string) => ({ id, acct: name, display_name: name.toUpperCase(), url: `https://masto.test/@${name}` });
    on(/notifications/, () => [
      { type: "mention", created_at: iso(30), account: acct("1", "ann"), status: { id: "s1", url: "https://masto.test/@ann/s1", content: "<p>@brand Love it</p>", visibility: "public", in_reply_to_id: "ours1" } },
      { type: "mention", created_at: iso(25), account: acct("2", "bob"), status: { id: "s2", content: "<p>@brand are you open?</p>", visibility: "direct", in_reply_to_id: null } },
      { type: "mention", created_at: iso(20), account: acct("3", "cy"), status: { id: "s3", content: "<p>cc @brand</p>", visibility: "public", in_reply_to_id: "someone-elses" } },
      { type: "mention", created_at: iso(15), account: acct("me", "brand"), status: { id: "s4", content: "<p>our reply</p>", visibility: "public", in_reply_to_id: "ours1" } },
      { type: "mention", created_at: iso(-5), account: acct("5", "old"), status: { id: "s5", content: "<p>too old</p>", visibility: "public" } },
    ]);
    const items = await mastodon.fetchInbound!({ channel, credentials, since: T0, posts: ["ours1"] });
    expect(items.map((i) => [i.externalId, i.kind, i.externalPostId, i.body])).toEqual([
      ["s1", "comment", "ours1", "Love it"],
      ["s2", "message", null, "are you open?"],
      ["s3", "mention", null, "cc @brand"],
    ]);
    expect(items[0]).toMatchObject({ authorName: "ANN", authorHandle: "@ann", authorUrl: "https://masto.test/@ann" });
    expect(calls.find((c) => /notifications/.test(c.url))!.url).toContain("types[]=mention");
  });

  it("says which scopes are missing when the token is refused", async () => {
    on(/verify_credentials/, () => ({ id: "me" }));
    on(/notifications/, () => new Response('{"error":"This action is outside the authorized scopes"}', { status: 403 }));
    await expect(mastodon.fetchInbound!({ channel, credentials, since: T0, posts: [] })).rejects.toThrow(/read:notifications/);
  });

  it("replies to the comment with the @name added and the same audience", async () => {
    on(/statuses\/s1$/, () => ({ id: "s1", content: "<p>Love it</p>", visibility: "unlisted", account: { id: "1", acct: "ann@other.test" } }));
    on(/api\/v1\/statuses$/, () => ({ id: "new1", url: "https://masto.test/@brand/new1" }));
    const out = await mastodon.sendReply!({ channel, credentials, replyTo: "s1", body: "Thank you!" });
    expect(out).toEqual({ externalId: "new1", externalUrl: "https://masto.test/@brand/new1" });
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(body(post)).toEqual({ status: "@ann@other.test Thank you!", in_reply_to_id: "s1", visibility: "unlisted" });
    expect((post.init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("reply-s1");
  });

  it("does not double the @name and keeps a direct message direct", async () => {
    on(/statuses\/s2$/, () => ({ id: "s2", content: "x", visibility: "direct", account: { id: "2", acct: "bob" } }));
    on(/api\/v1\/statuses$/, () => ({ id: "n" }));
    await mastodon.sendReply!({ channel, credentials, replyTo: "s2", body: "@bob yes, until 6" });
    expect(body(calls.find((c) => c.init?.method === "POST")!)).toMatchObject({ status: "@bob yes, until 6", visibility: "direct" });
  });

  it("refuses a reply that is over 500 characters once the @name is added", async () => {
    on(/statuses\/s3$/, () => ({ id: "s3", content: "x", visibility: "public", account: { id: "3", acct: "cy" } }));
    await expect(mastodon.sendReply!({ channel, credentials, replyTo: "s3", body: "a".repeat(499) })).rejects.toThrow(/500/);
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("reports favourites, replies and boosts", async () => {
    on(/statuses\/77$/, () => ({ id: "77", favourites_count: 9, replies_count: 2, reblogs_count: 5 }));
    expect(await mastodon.fetchMetrics!({ channel, externalPostId: "77", credentials })).toMatchObject({ likes: 9, commentCount: 2, shares: 5 });
  });

  it("needs an access token", async () => {
    await expect(mastodon.fetchInbound!({ channel, credentials: null, since: T0, posts: [] })).rejects.toBeInstanceOf(NotConnectedError);
  });
});
