"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, channels, activity } from "@/lib/db";
import { requireBrandRole } from "@/lib/auth";
import { getPlatform } from "@/lib/platforms";
import { encryptJson } from "@/lib/crypto";

export async function addChannelAction(brandId: string, formData: FormData) {
  const { user } = await requireBrandRole(brandId, "admin");
  const platform = String(formData.get("platform") ?? "");
  getPlatform(platform); // throws on an unknown platform id

  const [channel] = await db.insert(channels).values({
    brandId,
    platform,
    handle: String(formData.get("handle") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim() || null,
    mode: "manual",
    status: "connected", // manual channels are usable immediately
  }).returning();

  await db.insert(activity).values({
    brandId, actorId: user.id, action: "channel.added", entity: "channel", entityId: channel.id,
    meta: { platform },
  });
  revalidatePath("/", "layout");
  return channel.id;
}

export async function updateChannelAction(channelId: string, formData: FormData) {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw new Error("Channel not found");
  await requireBrandRole(channel.brandId, "admin");

  await db.update(channels).set({
    handle: String(formData.get("handle") ?? channel.handle).trim(),
    displayName: String(formData.get("displayName") ?? "").trim() || null,
    settings: JSON.parse(String(formData.get("settings") ?? "{}") || "{}"),
  }).where(eq(channels.id, channelId));
  revalidatePath("/", "layout");
}

/**
 * Stores API credentials for a channel and flips it to live mode.
 * Tokens are encrypted with APP_SECRET before they touch the database and are
 * never sent back to the browser.
 */
export async function connectChannelAction(channelId: string, formData: FormData) {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw new Error("Channel not found");
  const { user } = await requireBrandRole(channel.brandId, "admin");

  const platform = getPlatform(channel.platform);
  if (platform.manualOnly) {
    throw new Error(`${platform.name} has no write API — this channel stays in manual mode.`);
  }

  const accessToken = String(formData.get("accessToken") ?? "").trim();
  const refreshToken = String(formData.get("refreshToken") ?? "").trim();
  const externalId = String(formData.get("externalId") ?? "").trim();
  if (!accessToken) throw new Error("Paste an access token, or keep the channel in manual mode.");

  // Platforms that need more than a token (client ids, signer UUIDs, phone
  // number ids…) declare those keys; anything else in the form is ignored.
  const extras: Record<string, string> = {};
  for (const field of platform.credentialFields ?? []) {
    const value = String(formData.get(`cred_${field.key}`) ?? "").trim();
    if (value) extras[field.key] = value;
    else if (field.required) throw new Error(`${field.label} is required for ${channel.platform}.`);
  }

  const expiresIn = Number(formData.get("expiresIn") ?? 0);
  await db.update(channels).set({
    credentials: encryptJson({ accessToken, ...(refreshToken ? { refreshToken } : {}), ...extras }),
    externalId: externalId || channel.externalId,
    tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    mode: "live",
    status: "connected",
    lastError: null,
  }).where(eq(channels.id, channelId));

  await db.insert(activity).values({
    brandId: channel.brandId, actorId: user.id, action: "channel.connected", entity: "channel", entityId: channelId,
    meta: { platform: channel.platform },
  });
  revalidatePath("/", "layout");
}

export async function setChannelModeAction(channelId: string, mode: "manual" | "live") {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw new Error("Channel not found");
  await requireBrandRole(channel.brandId, "admin");
  if (mode === "live") {
    const platform = getPlatform(channel.platform);
    if (platform.manualOnly) throw new Error(`${platform.name} has no write API — it can only run in manual mode.`);
    if (!channel.credentials) throw new Error("Connect the account first — live mode needs an access token.");
  }
  await db.update(channels).set({ mode, status: mode === "live" ? "connected" : channel.status }).where(eq(channels.id, channelId));
  revalidatePath("/", "layout");
}

export async function disconnectChannelAction(channelId: string) {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw new Error("Channel not found");
  await requireBrandRole(channel.brandId, "admin");
  await db.update(channels).set({ credentials: null, tokenExpiresAt: null, mode: "manual", status: "connected" })
    .where(eq(channels.id, channelId));
  revalidatePath("/", "layout");
}

export async function archiveChannelAction(channelId: string) {
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) throw new Error("Channel not found");
  await requireBrandRole(channel.brandId, "admin");
  await db.update(channels).set({ archivedAt: new Date() }).where(eq(channels.id, channelId));
  revalidatePath("/", "layout");
}
