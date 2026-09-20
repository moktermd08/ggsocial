import {
  NotConnectedError,
  type MediaKind, type OptionField, type Platform, type PlatformCategory, type PlatformId,
} from "../types";

/**
 * Compact description of a channel that has no usable public write API for
 * organic content. The app still does everything up to the final click:
 * compose, validate, schedule, and hand a person a copy-ready checklist in the
 * publish queue.
 */
export type ManualSpec = {
  id: PlatformId;
  name: string;
  color: string;
  category: PlatformCategory;
  blurb: string;
  /** Why there is no live mode — surfaced in the UI so nobody hunts for a token. */
  why: string;
  docsUrl?: string;
  textMax?: number;
  media?: readonly MediaKind[];
  mediaMax?: number | null;
  mediaMin?: number;
  requiresMedia?: boolean;
  hashtags?: boolean;
  links?: boolean;
  needsTitle?: boolean;
  fields?: readonly OptionField[];
  /** Extra checklist lines appended after the generic ones. */
  steps?: readonly string[];
};

const TITLE_FIELD: OptionField = { key: "title", label: "Title / headline", type: "text", required: true };
const LINK_FIELD: OptionField = { key: "link", label: "Destination link", type: "text", placeholder: "https://…", help: "Where the lead should land." };

export function manualPlatform(spec: ManualSpec): Platform {
  return {
    id: spec.id,
    name: spec.name,
    color: spec.color,
    category: spec.category,
    blurb: spec.blurb,
    manualOnly: true,
    constraints: {
      textMax: spec.textMax ?? 5000,
      mediaMin: spec.mediaMin ?? 0,
      mediaMax: spec.mediaMax === undefined ? 10 : spec.mediaMax,
      allowedMedia: [...(spec.media ?? ["image", "video", "document"])],
      requiresMedia: spec.requiresMedia,
      supportsLinks: spec.links ?? true,
      hashtagsUseful: spec.hashtags ?? false,
    },
    optionFields: [
      ...(spec.needsTitle ? [TITLE_FIELD] : []),
      ...(spec.links === false ? [] : [LINK_FIELD]),
      ...(spec.fields ?? []),
      { key: "notes", label: "Note for whoever posts it", type: "textarea", placeholder: "Anything the poster needs to know." },
    ],
    liveSetup: {
      docsUrl: spec.docsUrl ?? "",
      envKeys: [],
      requiresAppReview: false,
      notes: `${spec.name} has no public write API for this content — ${spec.why} ggsocial prepares, schedules and queues the post; someone publishes the final step.`,
    },
    manualSteps: (ctx) => [
      { label: `Open ${spec.name}${ctx.channel.handle ? ` as ${ctx.channel.handle}` : ""}` },
      ...(spec.needsTitle ? [{ label: "Title", copy: String(ctx.options.title ?? ctx.post.title ?? "") }] : []),
      { label: "Body", copy: ctx.body },
      ...(ctx.media.length ? [{ label: `Attach ${ctx.media.length} file${ctx.media.length === 1 ? "" : "s"}`, detail: ctx.media.map((m) => m.originalName).join(", ") }] : []),
      ...(ctx.options.link ? [{ label: "Link", copy: String(ctx.options.link) }] : []),
      ...(spec.steps ?? []).map((label) => ({ label })),
      ...(ctx.firstComment ? [{ label: "First comment", copy: ctx.firstComment }] : []),
      ...(ctx.options.notes ? [{ label: "Note", detail: String(ctx.options.notes) }] : []),
      { label: "Paste the published URL back into the queue so analytics can track it" },
    ],
    // Routed to the manual queue by the publisher rather than failing the post.
    publish: async () => {
      throw new NotConnectedError(spec.name, `no public write API — ${spec.why}`);
    },
  };
}
