import { apiFetch, NotConnectedError, type Platform } from "../types";

const REST = "https://api.github.com";
const GQL = "https://api.github.com/graphql";

export const github: Platform = {
  id: "github",
  name: "GitHub",
  color: "#181717",
  category: "dev",
  blurb: "Discussions, issues and releases — where developer-tool buyers actually hang out.",
  constraints: {
    textMax: 60000,
    mediaMin: 0,
    mediaMax: 0,
    allowedMedia: [],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "kind", label: "Post as", type: "select", defaultValue: "discussion",
      choices: [
        { value: "discussion", label: "Discussion" },
        { value: "issue", label: "Issue" },
        { value: "release", label: "Release" },
      ] },
    { key: "repo", label: "Repository", type: "text", required: true, placeholder: "owner/repo" },
    { key: "title", label: "Title", type: "text", required: true },
    { key: "repositoryId", label: "Repository node ID", type: "text", help: "Discussions only — the GraphQL node id (R_…)." },
    { key: "categoryId", label: "Discussion category ID", type: "text", help: "Discussions only — the category node id (DIC_…)." },
    { key: "tag", label: "Release tag", type: "text", placeholder: "v1.4.0", help: "Releases only." },
    { key: "labels", label: "Labels", type: "text", placeholder: "announcement", help: "Issues only, comma separated." },
  ],
  validate: ({ options }) => {
    const issues = [];
    if (!/^[^/]+\/[^/]+$/.test(String(options.repo ?? ""))) issues.push({ level: "error" as const, message: "Repository must look like owner/repo." });
    if (!String(options.title ?? "").trim()) issues.push({ level: "error" as const, message: "Give it a title." });
    if (options.kind === "discussion" && (!options.repositoryId || !options.categoryId)) {
      issues.push({ level: "error" as const, message: "Discussions need the repository and category node IDs." });
    }
    if (options.kind === "release" && !String(options.tag ?? "").trim()) {
      issues.push({ level: "error" as const, message: "Releases need a tag." });
    }
    return issues;
  },
  manualSteps: (ctx) => [
    { label: `Open github.com/${String(ctx.options.repo ?? "")}` },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Markdown body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://docs.github.com/en/graphql/reference/mutations#creatediscussion",
    envKeys: [],
    requiresAppReview: false,
    notes: "Create a fine-grained personal access token with Discussions/Issues/Contents write on the target repo. Paste it as the access token.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("GitHub", "missing personal access token");
    const repo = String(ctx.options.repo ?? "");
    const title = String(ctx.options.title ?? ctx.post.title ?? "");
    const kind = String(ctx.options.kind ?? "discussion");
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };

    if (kind === "discussion") {
      const res = await apiFetch(GQL, {
        label: "GitHub discussion",
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `mutation($input: CreateDiscussionInput!) { createDiscussion(input: $input) { discussion { id url } } }`,
          variables: { input: { repositoryId: String(ctx.options.repositoryId), categoryId: String(ctx.options.categoryId), title, body: ctx.body } },
        }),
      });
      const errors = res.errors as { message?: string }[] | undefined;
      if (errors?.length) throw new Error(`GitHub rejected the discussion: ${errors.map((e) => e.message).join("; ").slice(0, 300)}`);
      const d = (((res.data as Record<string, unknown>)?.createDiscussion as Record<string, unknown>)?.discussion ?? {}) as Record<string, unknown>;
      return { externalId: String(d.id ?? ""), externalUrl: String(d.url ?? "") };
    }

    if (kind === "release") {
      const res = await apiFetch(`${REST}/repos/${repo}/releases`, {
        label: "GitHub release",
        method: "POST",
        headers,
        body: JSON.stringify({ tag_name: String(ctx.options.tag), name: title, body: ctx.body }),
      });
      return { externalId: String(res.id ?? ""), externalUrl: String(res.html_url ?? "") };
    }

    const res = await apiFetch(`${REST}/repos/${repo}/issues`, {
      label: "GitHub issue",
      method: "POST",
      headers,
      body: JSON.stringify({
        title, body: ctx.body,
        labels: String(ctx.options.labels ?? "").split(",").map((l) => l.trim()).filter(Boolean),
      }),
    });
    return { externalId: String(res.number ?? ""), externalUrl: String(res.html_url ?? "") };
  },
};
