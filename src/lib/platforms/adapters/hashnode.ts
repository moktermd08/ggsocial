import { apiFetch, NotConnectedError, type Platform } from "../types";

const GQL = "https://gql.hashnode.com/";

export const hashnode: Platform = {
  id: "hashnode",
  name: "Hashnode",
  color: "#2962FF",
  category: "blog",
  blurb: "Developer blogging on your own subdomain or domain, with built-in distribution.",
  constraints: {
    textMax: 100000,
    mediaMin: 0,
    mediaMax: 0,
    allowedMedia: [],
    supportsLinks: true,
    hashtagsUseful: true,
  },
  optionFields: [
    { key: "publicationId", label: "Publication ID", type: "text", required: true, help: "Blog dashboard → General → Publication ID." },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "slug", label: "Slug", type: "text" },
    { key: "tags", label: "Tag slugs", type: "text", placeholder: "nextjs, saas" },
    { key: "canonicalUrl", label: "Canonical URL", type: "text", placeholder: "https://yourbrand.com/blog/…" },
    { key: "coverImageUrl", label: "Cover image URL", type: "text" },
    { key: "subtitle", label: "Subtitle", type: "text" },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!String(options.title ?? "").trim()) issues.push({ level: "error" as const, message: "Hashnode posts need a title." });
    if (!String(options.publicationId ?? "").trim()) issues.push({ level: "error" as const, message: "Set the publication ID." });
    return issues;
  },
  manualSteps: (ctx) => [
    { label: "Open hashnode.com/draft" },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Markdown body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://apidocs.hashnode.com/",
    envKeys: [],
    requiresAppReview: false,
    notes: "Account settings → Developer → Generate new token. Paste it as the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Hashnode", "missing personal access token");

    const mutation = `mutation Publish($input: PublishPostInput!) {
      publishPost(input: $input) { post { id slug url } }
    }`;
    const tags = String(ctx.options.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

    const res = await apiFetch(GQL, {
      label: "Hashnode publishPost",
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            publicationId: String(ctx.options.publicationId),
            title: String(ctx.options.title ?? ctx.post.title ?? ""),
            subtitle: ctx.options.subtitle ? String(ctx.options.subtitle) : undefined,
            contentMarkdown: ctx.body,
            slug: ctx.options.slug ? String(ctx.options.slug) : undefined,
            tags: tags.map((slug) => ({ slug, name: slug })),
            originalArticleURL: ctx.options.canonicalUrl ? String(ctx.options.canonicalUrl) : undefined,
            coverImageOptions: ctx.options.coverImageUrl ? { coverImageURL: String(ctx.options.coverImageUrl) } : undefined,
          },
        },
      }),
    });
    const errors = res.errors as { message?: string }[] | undefined;
    if (errors?.length) throw new Error(`Hashnode rejected the post: ${errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    const post = (((res.data as Record<string, unknown>)?.publishPost as Record<string, unknown>)?.post ?? {}) as Record<string, unknown>;
    return { externalId: String(post.id ?? ""), externalUrl: String(post.url ?? "") };
  },
};
