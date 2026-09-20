import crypto from "node:crypto";

/**
 * AES-256-GCM at rest for platform OAuth tokens. The key is derived from
 * APP_SECRET so rotating that secret invalidates stored credentials
 * (channels then show as "expired" and must be reconnected).
 */
function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) throw new Error("APP_SECRET must be set (32+ chars recommended)");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptJson<T = unknown>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  try {
    const [iv, tag, data] = payload.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const dec = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}
