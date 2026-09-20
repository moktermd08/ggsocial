import { createHmac } from "node:crypto";
import { NotConnectedError, type Platform } from "../types";

/**
 * Escape hatch for everything without an adapter: POSTs the fully-rendered post
 * to any URL, so Zapier / Make / n8n / a custom endpoint can finish the job.
 */
export const webhook: Platform = {
  id: "webhook",
  name: "Webhook / Zapier",
  color: "#FF4A00",
  category: "automation",
  blurb: "POSTs the rendered post to any endpoint — wire up Zapier, Make, n8n or your own service.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: null,
    allowedMedia: ["image", "video", "document"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "url", label: "Endpoint URL", type: "text", required: true, placeholder: "https://hooks.zapier.com/…" },
    { key: "method", label: "Method", type: "select", defaultValue: "POST",
      choices: [{ value: "POST", label: "POST" }, { value: "PUT", label: "PUT" }] },
    { key: "extra", label: "Extra JSON fields", type: "textarea", placeholder: '{"campaign":"q4-launch"}', help: "Merged into the payload — useful for routing inside Zapier." },
  ],
  validate: ({ options }) => {
    const issues = [];
    const url = String(options.url ?? "");
    if (!/^https:\/\//.test(url)) issues.push({ level: "error" as const, message: "The endpoint must be an https URL." });
    if (options.extra) {
      try { JSON.parse(String(options.extra)); }
      catch { issues.push({ level: "error" as const, message: "Extra JSON fields are not valid JSON." }); }
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Send this payload to the endpoint yourself" },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "Any value (enables live mode)",
    docsUrl: "https://zapier.com/apps/webhook/integrations",
    envKeys: [],
    requiresAppReview: false,
    notes: "Paste any value as the access token to enable live mode; if you also store a signing secret, each request carries an X-GGSocial-Signature HMAC you can verify.",
  },
  credentialFields: [
    {
      key: "signingSecret",
      label: "Signing secret",
      help: "Optional — requests are then signed with an X-GGSocial-Signature HMAC."
    }
  ],
  publish: async (ctx) => {
    const url = String(ctx.options.url ?? ctx.credentials?.webhookUrl ?? "");
    if (!url) throw new NotConnectedError("Webhook", "no endpoint URL set");

    let extra: Record<string, unknown> = {};
    try { extra = ctx.options.extra ? JSON.parse(String(ctx.options.extra)) : {}; } catch { extra = {}; }

    const payload = {
      event: "post.publish",
      sentAt: new Date().toISOString(),
      brand: { id: ctx.brand.id, name: ctx.brand.name },
      channel: { id: ctx.channel.id, handle: ctx.channel.handle, displayName: ctx.channel.displayName },
      post: { id: ctx.post.id, title: ctx.post.title, scheduledAt: ctx.target.scheduledAt },
      body: ctx.body,
      firstComment: ctx.firstComment ?? null,
      media: ctx.media.map((m) => ({ url: ctx.publicUrl(m), kind: m.kind, name: m.originalName, altText: m.altText })),
      options: ctx.options,
      ...extra,
    };
    const raw = JSON.stringify(payload);

    const secret = ctx.credentials?.signingSecret;
    const res = await fetch(url, {
      method: String(ctx.options.method ?? "POST"),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ggsocial/1.0",
        ...(secret ? { "X-GGSocial-Signature": createHmac("sha256", secret).update(raw).digest("hex") } : {}),
      },
      body: raw,
    });
    if (!res.ok) throw new Error(`Webhook failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return { externalId: ctx.target.id, note: `Endpoint answered ${res.status}.` };
  },
};
