import "server-only";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, integrations, type IntegrationProvider } from "@/lib/db";
import { encryptJson, decryptJson } from "@/lib/crypto";

type ProviderConfig = {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Canva wants the client in a Basic header; Google takes it in the body. */
  basicAuth: boolean;
  extraAuthorizeParams?: Record<string, string>;
  /** Where to send people to register the app. Shown when env vars are missing. */
  consoleUrl: string;
};

export const PROVIDERS: Record<IntegrationProvider, ProviderConfig> = {
  canva: {
    name: "Canva",
    authorizeUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
    scopes: ["design:meta:read", "design:content:read", "profile:read"],
    clientIdEnv: "CANVA_CLIENT_ID",
    clientSecretEnv: "CANVA_CLIENT_SECRET",
    basicAuth: true,
    consoleUrl: "https://www.canva.com/developers/integrations",
  },
  google_photos: {
    name: "Google Photos",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    basicAuth: false,
    // offline + consent is the only way Google reliably hands back a refresh token.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
  },
};

export function isProvider(value: string): value is IntegrationProvider {
  return value in PROVIDERS;
}

function client(provider: IntegrationProvider) {
  const cfg = PROVIDERS[provider];
  const id = process.env[cfg.clientIdEnv];
  const secret = process.env[cfg.clientSecretEnv];
  return id && secret ? { id, secret } : null;
}

export function isConfigured(provider: IntegrationProvider) {
  return client(provider) !== null;
}

/**
 * Must match a redirect URL registered with the provider exactly. Canva
 * refuses "localhost", so in development APP_URL has to be http://127.0.0.1:3000.
 */
export function redirectUri(provider: IntegrationProvider) {
  const base = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  return `${base}/api/integrations/${provider}/callback`;
}

/* ------------------------------------------------------------ authorize */

/** Short-lived cookie carrying state + PKCE verifier across the redirect. */
export const PENDING_COOKIE = "ggs_oauth";

export type PendingAuth = { provider: IntegrationProvider; userId: string; state: string; verifier: string };

export function beginAuthorization(provider: IntegrationProvider, userId: string) {
  const cfg = PROVIDERS[provider];
  const c = client(provider);
  if (!c) throw new Error(`${cfg.name} is not configured. Set ${cfg.clientIdEnv} and ${cfg.clientSecretEnv}.`);

  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(cfg.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: c.id,
    redirect_uri: redirectUri(provider),
    scope: cfg.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...cfg.extraAuthorizeParams,
  }).toString();

  const pending: PendingAuth = { provider, userId, state, verifier };
  return { url: url.toString(), cookie: encryptJson(pending) };
}

export function readPending(cookie: string | undefined) {
  return decryptJson<PendingAuth>(cookie);
}

/* ---------------------------------------------------------------- tokens */

type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: number };

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(provider: IntegrationProvider, params: Record<string, string>): Promise<TokenResponse> {
  const cfg = PROVIDERS[provider];
  const c = client(provider);
  if (!c) throw new Error(`${cfg.name} is not configured.`);

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams(params);
  if (cfg.basicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}`;
  } else {
    body.set("client_id", c.id);
    body.set("client_secret", c.secret);
  }

  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(`${cfg.name} token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json;
}

function toTokens(json: TokenResponse, previousRefresh: string | null = null): Tokens {
  return {
    accessToken: json.access_token,
    // Canva rotates refresh tokens on every use; Google only sends one the first time.
    refreshToken: json.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export async function exchangeCode(provider: IntegrationProvider, code: string, verifier: string) {
  const json = await tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri(provider),
  });
  return toTokens(json);
}

export async function saveIntegration(userId: string, provider: IntegrationProvider, tokens: Tokens, accountName: string | null) {
  const credentials = encryptJson(tokens);
  await db.insert(integrations)
    .values({ userId, provider, accountName, credentials })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: { accountName, credentials, updatedAt: new Date() },
    });
}

export class NotConnectedError extends Error {}

/** A valid access token for this user, refreshed if it is about to expire. */
export async function getAccessToken(userId: string, provider: IntegrationProvider): Promise<string> {
  const name = PROVIDERS[provider].name;
  const row = await db.query.integrations.findFirst({
    where: and(eq(integrations.userId, userId), eq(integrations.provider, provider)),
  });
  const tokens = decryptJson<Tokens>(row?.credentials);
  if (!row || !tokens) throw new NotConnectedError(`Connect ${name} first.`);

  if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new NotConnectedError(`${name} session expired. Reconnect it.`);

  let fresh: Tokens;
  try {
    fresh = toTokens(await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }), tokens.refreshToken);
  } catch {
    throw new NotConnectedError(`${name} session expired. Reconnect it.`);
  }
  await db.update(integrations)
    .set({ credentials: encryptJson(fresh), updatedAt: new Date() })
    .where(eq(integrations.id, row.id));
  return fresh.accessToken;
}
