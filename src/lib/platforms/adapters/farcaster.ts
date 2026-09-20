import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.neynar.com/v2/farcaster";

export const farcaster: Platform = {
  id: "farcaster",
  name: "Farcaster",
  color: "#8A63D2",
  category: "social",
  blurb: "Casts to Farcaster channels via Neynar — a dense builder and crypto audience.",
  constraints: {
    textMax: 1024,
    mediaMin: 0,
    mediaMax: 2,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "channelId", label: "Channel", type: "text", placeholder: "founders", help: "Leave blank to cast to your home feed." },
    { key: "idem", label: "Idempotency key", type: "text", help: "Optional — defaults to the target id." },
  ],
  manualSteps: (ctx) => [
    { label: `Open Warpcast as ${ctx.channel.handle}` },
    { label: "Cast", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "Neynar API key",
    docsUrl: "https://docs.neynar.com/reference/post-cast",
    envKeys: ["NEYNAR_API_KEY"],
    requiresAppReview: false,
    notes: "Sign up at neynar.com, create a managed signer for the account, then paste the API key as the access token and the signer UUID as the account ID.",
  },
  credentialFields: [
    {
      key: "signerUuid",
      label: "Signer UUID",
      required: true,
      help: "The managed signer approved for this Farcaster account."
    }
  ],
  publish: async (ctx) => {
    const apiKey = ctx.credentials?.accessToken;
    const signerUuid = ctx.credentials?.signerUuid ?? ctx.channel.externalId;
    if (!apiKey) throw new NotConnectedError("Farcaster", "missing Neynar API key");
    if (!signerUuid) throw new NotConnectedError("Farcaster", "missing signer UUID");

    const res = await apiFetch(`${API}/cast`, {
      label: "Farcaster cast",
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        signer_uuid: signerUuid,
        text: ctx.body,
        idem: String(ctx.options.idem ?? ctx.target.id).slice(0, 16),
        ...(ctx.options.channelId ? { channel_id: String(ctx.options.channelId) } : {}),
        ...(ctx.media.length ? { embeds: ctx.media.slice(0, 2).map((m) => ({ url: ctx.publicUrl(m) })) } : {}),
      }),
    });
    const cast = (res.cast ?? {}) as Record<string, unknown>;
    const hash = String(cast.hash ?? "");
    return { externalId: hash, externalUrl: hash ? `https://warpcast.com/${ctx.channel.handle.replace(/^@/, "")}/${hash.slice(0, 10)}` : undefined };
  },
};
