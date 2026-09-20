import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.webflow.com/v2";

export const webflow: Platform = {
  id: "webflow",
  name: "Webflow",
  color: "#146EF5",
  category: "blog",
  blurb: "CMS collection items — blog posts and landing pages on your marketing site.",
  constraints: {
    textMax: 200000,
    mediaMin: 0,
    mediaMax: 10,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "collectionId", label: "Collection ID", type: "text", required: true },
    { key: "title", label: "Name", type: "text", required: true },
    { key: "slug", label: "Slug", type: "text" },
    { key: "bodyField", label: "Rich-text field slug", type: "text", defaultValue: "post-body", help: "The CMS field your body HTML goes into." },
    { key: "summaryField", label: "Summary field slug", type: "text", placeholder: "post-summary" },
    { key: "imageField", label: "Image field slug", type: "text", placeholder: "main-image" },
    { key: "live", label: "Publish live immediately", type: "boolean", defaultValue: true },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.collectionId ?? "").trim()) issues.push({ level: "error" as const, message: "Set the Webflow collection ID." });
    if (!String(options.title ?? "").trim()) issues.push({ level: "error" as const, message: "Collection items need a name." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open the Webflow CMS collection" },
    { label: "Name", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.webflow.com/data/reference/cms/collection-items/staged-items/create-item",
    envKeys: [],
    requiresAppReview: false,
    notes: "Site settings → Apps & Integrations → API access → Generate token with CMS write scope. Paste it as the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Webflow", "missing site API token");
    const collection = String(ctx.options.collectionId);
    const name = String(ctx.options.title ?? ctx.post.title ?? "");
    const slug = String(ctx.options.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
    const image = ctx.media.find((m) => m.kind === "image");

    const html = ctx.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n");
    const fieldData: Record<string, unknown> = { name, slug };
    fieldData[String(ctx.options.bodyField ?? "post-body")] = html;
    if (ctx.options.summaryField) fieldData[String(ctx.options.summaryField)] = ctx.body.slice(0, 200);
    if (ctx.options.imageField && image) fieldData[String(ctx.options.imageField)] = { url: ctx.publicUrl(image) };

    const live = ctx.options.live !== false;
    const res = await apiFetch(`${API}/collections/${collection}/items${live ? "/live" : ""}`, {
      label: "Webflow item",
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ isArchived: false, isDraft: !live, fieldData }),
    });
    return { externalId: String(res.id ?? ""), note: live ? "Published live." : "Staged — publish the site to make it visible." };
  },
};
