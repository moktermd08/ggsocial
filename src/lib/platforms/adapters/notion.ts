import { apiFetch, NotConnectedError, type Platform } from "../types";

const API = "https://api.notion.com/v1";

export const notion: Platform = {
  id: "notion",
  name: "Notion",
  color: "#000000",
  category: "blog",
  blurb: "Public pages and databases — changelogs, wikis and lead magnets you can ship in minutes.",
  constraints: {
    textMax: 100000,
    mediaMin: 0,
    mediaMax: 20,
    allowedMedia: ["image"],
    supportsLinks: true,
    hashtagsUseful: false,
  },
  optionFields: [
    { key: "databaseId", label: "Database ID", type: "text", required: true, help: "Share the database with your integration first." },
    { key: "title", label: "Page title", type: "text", required: true },
    { key: "titleProperty", label: "Title property name", type: "text", defaultValue: "Name" },
    { key: "extraProps", label: "Extra properties", type: "textarea", placeholder: 'Status=Published\nType=Blog', help: "One Name=Value per line; select and text properties only." },
  ],
  validate: ({ options }) => (
    String(options.title ?? "").trim() ? [] : [{ level: "error" as const, message: "Notion pages need a title." }]
  ),
  manualSteps: (ctx) => [
    { label: "Open the Notion database" },
    { label: "Title", copy: String(ctx.options.title ?? "") },
    { label: "Body", copy: ctx.body },
  ],
  liveSetup: {
    docsUrl: "https://developers.notion.com/reference/post-page",
    envKeys: [],
    requiresAppReview: false,
    notes: "Create an internal integration at notion.so/my-integrations, paste the secret as the access token, then share the target database with the integration.",
  },
  publish: async (ctx) => {
    const token = ctx.credentials?.accessToken;
    if (!token) throw new NotConnectedError("Notion", "missing integration secret");
    const titleProp = String(ctx.options.titleProperty ?? "Name");

    const properties: Record<string, unknown> = {
      [titleProp]: { title: [{ text: { content: String(ctx.options.title ?? ctx.post.title ?? "").slice(0, 2000) } }] },
    };
    for (const line of String(ctx.options.extraProps ?? "").split("\n")) {
      const [k, ...rest] = line.split("=");
      const v = rest.join("=").trim();
      if (k?.trim() && v) properties[k.trim()] = { rich_text: [{ text: { content: v } }] };
    }

    const children: unknown[] = ctx.body
      .split(/\n{2,}/)
      .filter(Boolean)
      .slice(0, 90)
      .map((p) => ({
        object: "block", type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 2000) } }] },
      }));
    for (const m of ctx.media.filter((x) => x.kind === "image").slice(0, 10)) {
      children.push({ object: "block", type: "image", image: { type: "external", external: { url: ctx.publicUrl(m) } } });
    }

    const res = await apiFetch(`${API}/pages`, {
      label: "Notion page",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({ parent: { database_id: String(ctx.options.databaseId) }, properties, children }),
    });
    return { externalId: String(res.id ?? ""), externalUrl: String(res.url ?? "") };
  },
};
