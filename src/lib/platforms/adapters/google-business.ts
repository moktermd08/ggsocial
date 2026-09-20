import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://mybusiness.googleapis.com/v4";

export const googleBusiness: Platform = {
  id: "google_business",
  name: "Google Business Profile",
  color: "#4285F4",
  category: "local",
  blurb: "Posts on your Maps and Search listing — the highest-intent surface a local business has.",
  constraints: {
    textMax: 1500,
    mediaMin: 0,
    mediaMax: 1,
    allowedMedia: ["image", "video"],
    supportsLinks: true,
    hashtagsUseful: false,
    aspectRatioHint: "4:3, at least 720×540",
  },
  optionFields: [
    { key: "locationName", label: "Location resource", type: "text", required: true, placeholder: "accounts/123/locations/456" },
    { key: "topicType", label: "Post type", type: "select", defaultValue: "STANDARD",
      choices: [
        { value: "STANDARD", label: "Update" },
        { value: "EVENT", label: "Event" },
        { value: "OFFER", label: "Offer" },
      ] },
    { key: "ctaType", label: "Call to action", type: "select", defaultValue: "LEARN_MORE",
      choices: [
        { value: "LEARN_MORE", label: "Learn more" },
        { value: "BOOK", label: "Book" },
        { value: "ORDER", label: "Order online" },
        { value: "SIGN_UP", label: "Sign up" },
        { value: "CALL", label: "Call" },
        { value: "", label: "None" },
      ] },
    { key: "ctaUrl", label: "CTA link", type: "text", placeholder: "https://…" },
    { key: "eventTitle", label: "Event / offer title", type: "text" },
    { key: "startDate", label: "Start date", type: "text", placeholder: "2026-10-01" },
    { key: "endDate", label: "End date", type: "text", placeholder: "2026-10-31" },
  ],
  validate: ({ options, body }) => {
    const issues = [];
    if (!String(options.locationName ?? "").trim()) issues.push({ level: "error" as const, message: "Set the location resource name." });
    if (options.ctaType && options.ctaType !== "CALL" && !String(options.ctaUrl ?? "").trim()) {
      issues.push({ level: "error" as const, message: "That call to action needs a link." });
    }
    if ((options.topicType === "EVENT" || options.topicType === "OFFER") && !String(options.eventTitle ?? "").trim()) {
      issues.push({ level: "error" as const, message: "Events and offers need a title." });
    }
    if (body.length > 1500) issues.push({ level: "error" as const, message: "Google caps posts at 1500 characters." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open business.google.com → Posts" },
    { label: "Post text", copy: ctx.body },
    ...(ctx.options.ctaUrl ? [{ label: "CTA link", copy: String(ctx.options.ctaUrl) }] : []),
  ],
  liveSetup: {
    docsUrl: "https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    requiresAppReview: true,
    notes: "Request access to the Business Profile APIs in Google Cloud (approval takes days), then run OAuth with the business.manage scope and paste the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Google Business Profile", "missing OAuth access token");
    const location = String(ctx.options.locationName ?? ctx.channel.externalId ?? "");
    const topic = String(ctx.options.topicType ?? "STANDARD");
    const cta = String(ctx.options.ctaType ?? "");
    const m = ctx.media[0];
    const date = (raw: unknown) => {
      const [y, mo, d] = String(raw ?? "").split("-").map(Number);
      return y && mo && d ? { year: y, month: mo, day: d } : undefined;
    };
    const start = date(ctx.options.startDate);
    const end = date(ctx.options.endDate);

    const res = await apiFetch(`${API}/${location}/localPosts`, {
      label: "Google Business post",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        languageCode: "en",
        summary: ctx.body.slice(0, 1500),
        topicType: topic,
        ...(cta ? { callToAction: { actionType: cta, ...(cta === "CALL" ? {} : { url: String(ctx.options.ctaUrl ?? "") }) } } : {}),
        ...(m ? { media: [{ mediaFormat: m.kind === "video" ? "VIDEO" : "PHOTO", sourceUrl: ctx.publicUrl(m) }] } : {}),
        ...(topic !== "STANDARD"
          ? { event: { title: String(ctx.options.eventTitle ?? ""), schedule: { ...(start ? { startDate: start } : {}), ...(end ? { endDate: end } : {}) } } }
          : {}),
      }),
    });
    return { externalId: String(res.name ?? ""), externalUrl: String(res.searchUrl ?? "") };
  },
};
