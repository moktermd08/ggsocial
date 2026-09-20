import { apiFetch, NotConnectedError, type Platform } from "../types";

/** Mailchimp keys carry their data centre as a suffix: abc123…-us14 */
function dc(key: string) {
  const suffix = key.split("-").pop();
  if (!suffix || !/^[a-z]{2}\d+$/.test(suffix)) throw new Error("Mailchimp API key is missing its -usX data-centre suffix.");
  return suffix;
}

export const mailchimp: Platform = {
  id: "mailchimp",
  name: "Mailchimp",
  color: "#FFE01B",
  category: "email",
  blurb: "Email campaigns to an audience you own — still the highest ROI channel on this list.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "listId", label: "Audience (list) ID", type: "text", required: true },
    { key: "subject", label: "Subject line", type: "text", required: true },
    { key: "previewText", label: "Preview text", type: "text" },
    { key: "fromName", label: "From name", type: "text", required: true },
    { key: "replyTo", label: "Reply-to address", type: "text", required: true },
    { key: "segmentId", label: "Segment ID", type: "number", help: "Optional — send to a saved segment instead of everyone." },
    { key: "sendNow", label: "Send immediately", type: "boolean", defaultValue: false, help: "Off creates the campaign as a draft for a human to review." },
  ],
  validate: ({ options }) => {
    const issues = [];
    for (const [k, label] of [["listId", "Audience ID"], ["subject", "Subject line"], ["fromName", "From name"], ["replyTo", "Reply-to address"]] as const) {
      if (!String(options[k] ?? "").trim()) issues.push({ level: "error" as const, message: `${label} is required.` });
    }
    if (options.sendNow) issues.push({ level: "warn" as const, message: "This sends to the whole audience the moment the post publishes." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open Mailchimp → Campaigns" },
    { label: "Subject", copy: String(ctx.options.subject ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://mailchimp.com/developer/marketing/api/campaigns/add-campaign/",
    envKeys: [],
    requiresAppReview: false,
    notes: "Account → Extras → API keys. Paste the key (including the -usX suffix) as the access token.",
  },
  publish: async (ctx) => {
    const key = ctx.credentials?.accessToken;
    if (!key) throw new NotConnectedError("Mailchimp", "missing API key");
    const base = `https://${dc(key)}.api.mailchimp.com/3.0`;
    const auth = { Authorization: `Basic ${Buffer.from(`anystring:${key}`).toString("base64")}`, "Content-Type": "application/json" };

    const campaign = await apiFetch(`${base}/campaigns`, {
      label: "Mailchimp campaign",
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        type: "regular",
        recipients: {
          list_id: String(ctx.options.listId),
          ...(ctx.options.segmentId ? { segment_opts: { saved_segment_id: Number(ctx.options.segmentId) } } : {}),
        },
        settings: {
          subject_line: String(ctx.options.subject ?? ""),
          preview_text: ctx.options.previewText ? String(ctx.options.previewText) : undefined,
          title: ctx.post.title || String(ctx.options.subject ?? ""),
          from_name: String(ctx.options.fromName ?? ""),
          reply_to: String(ctx.options.replyTo ?? ""),
          auto_footer: true,
        },
      }),
    });
    const id = String(campaign.id ?? "");

    const html = [
      ...ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`),
      ...ctx.media.filter((m) => m.kind === "image").map((m) => `<img src="${ctx.publicUrl(m)}" alt="${m.altText ?? ""}" style="max-width:100%"/>`),
    ].join("\n");
    await apiFetch(`${base}/campaigns/${id}/content`, {
      label: "Mailchimp content", method: "PUT", headers: auth, body: JSON.stringify({ html }),
    });

    if (ctx.options.sendNow) {
      await apiFetch(`${base}/campaigns/${id}/actions/send`, { label: "Mailchimp send", method: "POST", headers: auth });
    }
    return {
      externalId: id,
      externalUrl: String((campaign.archive_url as string) ?? ""),
      note: ctx.options.sendNow ? "Campaign sent." : "Campaign created as a draft — review and send in Mailchimp.",
    };
  },
};
