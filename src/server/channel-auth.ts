import "server-only";
import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db, activity, channelConnections, channels } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";

/**
 * Signing a channel in with its platform — "Connect with Facebook" — instead
 * of pasting a token, and keeping that sign-in alive afterwards.
 *
 * Meta: one sign-in covers Facebook Pages and the Instagram business accounts
 * linked to them. The Page token that comes from a long-lived user token does
 * not expire, so there is nothing to refresh; if Meta revokes it, the channel
 * is marked for reconnecting.
 *
 * Google: one sign-in covers YouTube. Its access token lasts an hour and is
 * refreshed with the stored refresh token whenever it is about to run out.
 *
 * Tokens never reach the browser: they are encrypted before they are stored,
 * whether on the channel or in a connection waiting for the person to pick an
 * account.
 */

export type ChannelProvider = "meta" | "google";

type ProviderConfig = {
  name: string;
  platforms: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  consoleUrl: string;
};

export const CHANNEL_PROVIDERS: Record<ChannelProvider, ProviderConfig> = {
  meta: {
    name: "Facebook",
    platforms: ["facebook", "instagram"],
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    consoleUrl: "https://developers.facebook.com/apps",
  },
  google: {
    name: "Google",
    platforms: ["youtube"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
  },
};

const GRAPH = "https://graph.facebook.com/v21.0";
const META_SCOPES = [
  "pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement",
  "pages_read_user_content", "read_insights", "business_management",
  "instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights",
];
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.upload",
];

export function isChannelProvider(v: string): v is ChannelProvider {
  return v in CHANNEL_PROVIDERS;
}

export function providerFor(platform: string): ChannelProvider | null {
  for (const [key, cfg] of Object.entries(CHANNEL_PROVIDERS)) if (cfg.platforms.includes(platform)) return key as ChannelProvider;
  return null;
}

function client(provider: ChannelProvider) {
  const cfg = CHANNEL_PROVIDERS[provider];
  const id = process.env[cfg.clientIdEnv];
  const secret = process.env[cfg.clientSecretEnv];
  return id && secret ? { id, secret } : null;
}

export function channelAuthConfigured(provider: ChannelProvider) {
  return client(provider) !== null;
}

/** Register exactly this URL with the provider. */
export function channelRedirectUri(provider: ChannelProvider) {
  const base = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  return `${base}/api/channels/connect/${provider}/callback`;
}

/* ------------------------------------------------------------ authorize */

export const CHANNEL_PENDING_COOKIE = "ggs_channel_oauth";

export type PendingChannelAuth = { provider: ChannelProvider; channelId: string; userId: string; state: string; verifier: string };

export function beginChannelAuth(provider: ChannelProvider, channelId: string, userId: string) {
  const cfg = CHANNEL_PROVIDERS[provider];
  const c = client(provider);
  if (!c) throw new Error(`Connecting with ${cfg.name} is not set up: add ${cfg.clientIdEnv} and ${cfg.clientSecretEnv} to the server's .env.`);
  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const url = provider === "meta"
    ? new URL("https://www.facebook.com/v21.0/dialog/oauth")
    : new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams(provider === "meta"
    ? { client_id: c.id, redirect_uri: channelRedirectUri(provider), state, response_type: "code", scope: META_SCOPES.join(",") }
    : {
        client_id: c.id, redirect_uri: channelRedirectUri(provider), state, response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
        // offline + consent is the only way Google reliably hands back a refresh token.
        access_type: "offline", prompt: "consent", include_granted_scopes: "true",
      },
  ).toString();
  const pending: PendingChannelAuth = { provider, channelId, userId, state, verifier };
  return { url: url.toString(), cookie: encryptJson(pending) };
}

export function readChannelPending(cookie: string | undefined) {
  return decryptJson<PendingChannelAuth>(cookie);
}

/* ------------------------------------------------------------ accounts */

/** One account a sign-in can connect a channel to, with the credentials that go with it. */
export type ConnectCandidate = {
  externalId: string;
  name: string;
  handle: string;
  credentials: Record<string, string>;
  /** When the access token runs out, in ms. Absent = it does not. */
  expiresAt?: number;
};

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error) {
    const err = json.error as { message?: string } | string | undefined;
    const message = typeof err === "string" ? (json.error_description as string) ?? err : err?.message;
    throw new Error(message ?? `HTTP ${res.status}`);
  }
  return json;
}

/**
 * Trades the code the provider sent back for the accounts this sign-in can
 * reach on the channel's platform: Pages for Facebook, the Instagram accounts
 * linked to them for Instagram, channels for YouTube.
 */
export async function accountsFromCode(provider: ChannelProvider, platform: string, code: string, verifier: string): Promise<ConnectCandidate[]> {
  const c = client(provider);
  if (!c) throw new Error(`${CHANNEL_PROVIDERS[provider].name} is not set up on this server.`);
  const redirect = channelRedirectUri(provider);

  if (provider === "meta") {
    const short = await getJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: c.id, client_secret: c.secret, redirect_uri: redirect, code })}`);
    // A long-lived user token is what makes the Page tokens below non-expiring.
    const long = await getJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: c.id, client_secret: c.secret, fb_exchange_token: String(short.access_token),
    })}`);
    const pages = await getJson(`${GRAPH}/me/accounts?${new URLSearchParams({
      fields: "id,name,username,access_token,instagram_business_account{id,username,name}", limit: "100", access_token: String(long.access_token),
    })}`);
    type Page = { id: string; name: string; username?: string; access_token: string; instagram_business_account?: { id: string; username: string; name?: string } };
    const list = (pages.data as Page[] | undefined) ?? [];
    if (platform === "instagram") {
      return list.filter((p) => p.instagram_business_account).map((p) => ({
        externalId: p.instagram_business_account!.id,
        name: p.instagram_business_account!.name ?? p.instagram_business_account!.username,
        handle: `@${p.instagram_business_account!.username}`,
        // Instagram's Graph API is called with the linked Page's token.
        credentials: { accessToken: p.access_token, provider: "meta", pageId: p.id },
      }));
    }
    return list.map((p) => ({
      externalId: p.id, name: p.name, handle: p.username ? `@${p.username}` : p.name,
      credentials: { accessToken: p.access_token, provider: "meta" },
    }));
  }

  const tokens = await getJson(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect, client_id: c.id, client_secret: c.secret }),
  });
  const accessToken = String(tokens.access_token);
  const refreshToken = tokens.refresh_token ? String(tokens.refresh_token) : "";
  if (!refreshToken) throw new Error("Google did not return a refresh token. Remove ggsocial from your Google account's third-party access, then connect again.");
  const expiresAt = Date.now() + Number(tokens.expires_in ?? 3600) * 1000;
  const yt = await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  type Ch = { id: string; snippet: { title: string; customUrl?: string } };
  return ((yt.items as Ch[] | undefined) ?? []).map((ch) => ({
    externalId: ch.id, name: ch.snippet.title, handle: ch.snippet.customUrl ?? ch.snippet.title,
    credentials: { accessToken, refreshToken, provider: "google" }, expiresAt,
  }));
}

/** The account that is plainly this channel: the only one, or the one whose name or handle matches. */
export function pickObvious(candidates: ConnectCandidate[], channel: { handle: string; displayName: string | null; externalId: string | null }) {
  if (candidates.length === 1) return candidates[0];
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
  const wanted = new Set([norm(channel.handle), norm(channel.displayName)].filter(Boolean));
  const hits = candidates.filter((c) => c.externalId === channel.externalId || wanted.has(norm(c.handle)) || wanted.has(norm(c.name)));
  return hits.length === 1 ? hits[0] : null;
}

export async function connectChannel(channelId: string, candidate: ConnectCandidate, userId: string) {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw new Error("Channel not found.");
  await db.update(channels).set({
    credentials: encryptJson(candidate.credentials),
    externalId: candidate.externalId,
    displayName: channel.displayName ?? candidate.name,
    tokenExpiresAt: candidate.expiresAt ? new Date(candidate.expiresAt) : null,
    mode: "live", status: "connected", lastError: null,
  }).where(eq(channels.id, channelId));
  await db.insert(activity).values({
    brandId: channel.brandId, actorId: userId, action: "channel.connected", entity: "channel", entityId: channelId,
    meta: { platform: channel.platform, account: candidate.name, via: candidate.credentials.provider },
  });
}

/** Keeps a sign-in with several accounts until the person picks one. Returns its id. */
export async function holdCandidates(channelId: string, userId: string, candidates: ConnectCandidate[]) {
  await db.delete(channelConnections).where(lt(channelConnections.createdAt, new Date(Date.now() - 15 * 60_000)));
  const [row] = await db.insert(channelConnections).values({ channelId, userId, candidates: encryptJson(candidates) }).returning();
  return row.id;
}

export async function heldCandidates(connectionId: string, userId: string) {
  const row = await db.query.channelConnections.findFirst({
    where: and(eq(channelConnections.id, connectionId), eq(channelConnections.userId, userId)),
  });
  if (!row || row.createdAt.getTime() < Date.now() - 15 * 60_000) return null;
  return { channelId: row.channelId, candidates: decryptJson<ConnectCandidate[]>(row.candidates) ?? [] };
}

export async function dropHeld(connectionId: string) {
  await db.delete(channelConnections).where(eq(channelConnections.id, connectionId));
}

/* -------------------------------------------------------------- refresh */

export class ReconnectError extends Error {}

/**
 * A channel's credentials, ready to use: a Google token about to run out is
 * refreshed first and stored. A refresh the provider refuses marks the
 * channel for reconnecting and throws ReconnectError; callers treat it like
 * a channel that was never connected.
 */
export async function freshCredentials(channel: typeof channels.$inferSelect): Promise<Record<string, string> | null> {
  const creds = decryptJson<Record<string, string>>(channel.credentials);
  if (!creds || creds.provider !== "google" || !creds.refreshToken) return creds;
  if (channel.tokenExpiresAt && channel.tokenExpiresAt.getTime() > Date.now() + 5 * 60_000) return creds;

  const c = client("google");
  if (!c) return creds;
  try {
    const json = await getJson(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: c.id, client_secret: c.secret }),
    });
    const next = { ...creds, accessToken: String(json.access_token) };
    const expiresAt = new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000);
    await db.update(channels).set({ credentials: encryptJson(next), tokenExpiresAt: expiresAt, status: "connected", lastError: null })
      .where(eq(channels.id, channel.id));
    return next;
  } catch (err) {
    await markReconnect(channel, `Google refused to refresh the sign-in (${err instanceof Error ? err.message : String(err)}). Connect it again.`);
    throw new ReconnectError(`${channel.handle} needs connecting again.`);
  }
}

/**
 * A sign-in the platform no longer accepts. The channel drops back to manual
 * — posts still go out, through the publish queue — until someone reconnects.
 */
export async function markReconnect(channel: typeof channels.$inferSelect, message: string) {
  await db.update(channels).set({ status: "expired", mode: "manual", lastError: message }).where(eq(channels.id, channel.id));
  await db.insert(activity).values({
    brandId: channel.brandId, actorId: null, action: "channel.expired", entity: "channel", entityId: channel.id,
    meta: { platform: channel.platform, message },
  });
}

/** Meta's way of saying a token is dead: error code 190 in the Graph response. */
export function isRevokedToken(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  return /"code":\s*190\b|OAuthException.*(expired|invalid|session)/i.test(text);
}
