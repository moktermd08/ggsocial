import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.linkedin.com/rest";
const VERSION = "202506";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

export const linkedin: Platform = {
  id: "linkedin",
  name: "LinkedIn",
  color: "#0A66C2",
  category: "social",
  blurb: "Posts to a Company Page or a personal profile, including documents and articles.",
  constraints: {
    textMax: 3000,
    mediaMin: 0,
    mediaMax: 20,
    allowedMedia: ["image", "video", "document"],
    supportsFirstComment: true,
    supportsLinks: true,
    hashtagsUseful: true,
    aspectRatioHint: "1.91:1 or 1:1; documents as PDF",
  },
  optionFields: [
    { key: "visibility", label: "Visibility", type: "select", defaultValue: "PUBLIC",
      choices: [{ value: "PUBLIC", label: "Anyone" }, { value: "CONNECTIONS", label: "Connections only" }] },
    { key: "link", label: "Article link", type: "text", placeholder: "https://…" },
    { key: "documentTitle", label: "Document title", type: "text", help: "Shown on PDF carousels." },
  ],
  validate: ({ body, media }) => {
    const issues = [];
    if (body.length > 3000) issues.push({ level: "error" as const, message: "LinkedIn cuts off at 3,000 characters." });
    if (body.length > 1300) issues.push({ level: "warn" as const, message: "Only the first ~140 characters show before “see more”." });
    if (media.filter((m) => m.kind === "document").length > 1) {
      issues.push({ level: "error" as const, message: "One document per LinkedIn post." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open LinkedIn as ${ctx.channel.displayName ?? ctx.channel.handle}` },
    { label: "Paste the post", copy: ctx.body },
    ...(ctx.media.length ? [{ label: `Attach ${ctx.media.length} file(s)` }] : []),
    ...(ctx.firstComment ? [{ label: "Add the first comment", copy: ctx.firstComment }] : []),
  ],
  liveSetup: {
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
    envKeys: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    requiresAppReview: true,
    notes: "Requires the Community Management API product (w_organization_social) — LinkedIn approves this per app, and it is the slowest of the platforms to get.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    const author = ctx.channel.externalId; // urn:li:organization:123 or urn:li:person:abc
    if (!token || !author) throw new NotConnectedError("LinkedIn", "missing access token or author URN");

    // Register + upload each asset, then reference it in the post.
    const uploadImage = async (url: string) => {
      const init = await apiFetch(`${API}/images?action=initializeUpload`, {
        label: "LinkedIn image init",
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      });
      const value = init.value as { uploadUrl: string; image: string };
      const file = await fetch(url).then((r) => r.arrayBuffer());
      const put = await fetch(value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: file });
      if (!put.ok) throw new Error(`LinkedIn asset upload failed (${put.status})`);
      return value.image;
    };

    const images = ctx.media.filter((m) => m.kind === "image");
    const assets: string[] = [];
    for (const m of images) assets.push(await uploadImage(ctx.publicUrl(m)));

    const content =
      assets.length > 1
        ? { multiImage: { images: assets.map((id) => ({ id })) } }
        : assets.length === 1
          ? { media: { id: assets[0] } }
          : ctx.options.link
            ? { article: { source: String(ctx.options.link), title: String(ctx.options.documentTitle ?? "") || undefined } }
            : undefined;

    const res = await fetch(`${API}/posts`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        author,
        commentary: ctx.body,
        visibility: String(ctx.options.visibility ?? "PUBLIC"),
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn post failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const urn = res.headers.get("x-restli-id") ?? "";
    return { externalId: urn, externalUrl: `https://www.linkedin.com/feed/update/${urn}` };
  },
};
