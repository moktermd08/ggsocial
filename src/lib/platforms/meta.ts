import { PLATFORM_LIST, type Constraints, type CredentialField, type OptionField, type PlatformCategory, type PlatformId } from "./index";

export { hasPublicPage } from "./index";

/** Plain, serialisable platform description for client components. */
export type PlatformMeta = {
  id: PlatformId;
  name: string;
  color: string;
  category: PlatformCategory;
  manualOnly: boolean;
  blurb: string;
  constraints: Constraints;
  optionFields: OptionField[];
  credentialFields: CredentialField[];
  liveSetup: { docsUrl: string; envKeys: string[]; requiresAppReview: boolean; notes: string; tokenLabel?: string };
};

export function platformMeta(): PlatformMeta[] {
  return PLATFORM_LIST.map((p) => ({
    id: p.id, name: p.name, color: p.color, category: p.category,
    manualOnly: Boolean(p.manualOnly), blurb: p.blurb,
    constraints: p.constraints, optionFields: p.optionFields,
    credentialFields: p.credentialFields ?? [], liveSetup: p.liveSetup,
  }));
}

/** Client-side mirror of the server's generic checks, for instant feedback. */
export function quickValidate(meta: PlatformMeta, args: {
  body: string;
  media: { kind: string; originalName: string }[];
  options: Record<string, unknown>;
}) {
  const issues: { level: "error" | "warn"; message: string }[] = [];
  const c = meta.constraints;
  if (args.body.length > c.textMax) {
    issues.push({ level: "error", message: `${args.body.length} / ${c.textMax} characters.` });
  }
  if (c.requiresMedia && args.media.length < Math.max(1, c.mediaMin)) {
    issues.push({ level: "error", message: `Needs at least ${Math.max(1, c.mediaMin)} media file.` });
  }
  if (c.mediaMax !== null && args.media.length > c.mediaMax) {
    issues.push({ level: "error", message: `Too many files — max ${c.mediaMax}.` });
  }
  for (const m of args.media) {
    if (!c.allowedMedia.includes(m.kind as "image" | "video" | "document")) {
      issues.push({ level: "error", message: `${m.originalName}: ${m.kind} not supported here.` });
    }
  }
  for (const f of meta.optionFields) {
    if (f.required && !String(args.options[f.key] ?? "").trim()) {
      issues.push({ level: "error", message: `"${f.label}" is required.` });
    }
  }
  if (!args.body.trim() && args.media.length === 0) {
    issues.push({ level: "error", message: "Nothing to post yet." });
  }
  return issues;
}
