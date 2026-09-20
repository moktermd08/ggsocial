import { apiFetch, NotConnectedError, type Platform } from "../types";

export const twilioSms: Platform = {
  id: "twilio_sms",
  name: "SMS (Twilio)",
  color: "#F22F46",
  category: "email",
  blurb: "Text messages — near-100% open rates, best reserved for real offers and reminders.",
  constraints: {
    textMax: 1600,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "to", label: "Recipients", type: "textarea", required: true, placeholder: "+8801700000000, +14155550100", help: "E.164 numbers that opted in." },
    { key: "from", label: "From number or Messaging Service SID", type: "text", required: true, placeholder: "+14155550123 or MGxxxxxxxx" },
  ],
  validate: ({ options, body }) => {
    const issues = [];
    const list = String(options.to ?? "").split(/[\s,;]+/).filter(Boolean);
    if (!list.length) issues.push({ level: "error" as const, message: "Add at least one recipient number." });
    if (!String(options.from ?? "").trim()) issues.push({ level: "error" as const, message: "Set the sending number or Messaging Service SID." });
    if (body.length > 160) issues.push({ level: "warn" as const, message: `${body.length} characters — this bills as ${Math.ceil(body.length / 153)} segments per recipient.` });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Send from your SMS tool" },
    { label: "Recipients", copy: String(ctx.options.to ?? "") },
    { label: "Message", copy: ctx.body },
  ],
  liveSetup: {
    tokenLabel: "Auth Token",
    docsUrl: "https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource",
    envKeys: [],
    requiresAppReview: false,
    notes: "Paste the Account SID as the account ID and the Auth Token as the access token. Sender numbers need local registration in most countries.",
  },
  credentialFields: [
    {
      key: "accountSid",
      label: "Account SID",
      required: true,
      placeholder: "ACxxxxxxxx"
    }
  ],
  publish: async (ctx) => {
    const sid = ctx.credentials?.accountSid ?? ctx.channel.externalId;
    const token = ctx.credentials?.accessToken;
    if (!sid || !token) throw new NotConnectedError("SMS (Twilio)", "missing Account SID or Auth Token");
    const from = String(ctx.options.from ?? "");
    const list = String(ctx.options.to ?? "").split(/[\s,;]+/).filter(Boolean);
    const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
    const image = ctx.media.find((m) => m.kind === "image");

    const sent: string[] = [];
    const failed: string[] = [];
    for (const to of list) {
      const params = new URLSearchParams({
        To: to,
        Body: ctx.body,
        ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }),
        ...(image ? { MediaUrl: ctx.publicUrl(image) } : {}),
      });
      try {
        const res = await apiFetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          label: "Twilio SMS",
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        sent.push(String(res.sid ?? to));
      } catch {
        failed.push(to);
      }
    }
    if (!sent.length) throw new Error(`Twilio delivered to none of the ${list.length} numbers.`);
    return { externalId: sent[0], note: `Sent ${sent.length}/${list.length}${failed.length ? ` — failed: ${failed.slice(0, 5).join(", ")}` : ""}.` };
  },
};
