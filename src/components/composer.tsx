"use client";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Plus, Sparkles, Trash2, Upload, X, Zap } from "lucide-react";
import { PlatformIcon } from "./platform-icon";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import { BrandBook, findBannedWords } from "./brand-book";
import { quickValidate, type PlatformMeta } from "@/lib/platforms/meta";
import { toLocalInput, fromLocalInput } from "@/lib/format";
import { savePostAction, type PostInput } from "@/server/actions/posts";
import type { MasterValues } from "@/lib/masters";
import { findPlaceholders, type TemplateOption } from "@/lib/templates";
import { LabelRow, MasterTag } from "./master-panels";
import { uploadMediaAction } from "@/server/actions/media";
import { generateDraftAction } from "@/server/actions/drafting";

export type ComposerChannel = {
  id: string; platform: string; handle: string; displayName: string | null; mode: string;
  /** This channel's saved option defaults — prefilled into every new target. */
  settings: Record<string, unknown>;
};
export type ComposerMedia = {
  id: string; url: string; kind: string; originalName: string;
  /** A master asset, shared by every brand. */
  isMaster?: boolean;
};
export type ComposerBrand = {
  id: string; name: string; color: string; timezone: string;
  /** The parts of the brand book a writer needs while writing. */
  brief: string | null; voice: string | null; audience: string | null; ctaText: string | null;
  valueProps: string[]; bannedWords: string[]; defaultHashtags: string[]; emojiPolicy: string;
};

export type ComposerPost = {
  id: string;
  /** The content-plan idea this post tells, if it was fanned out from one. */
  ideaId?: string | null;
  title: string;
  body: string;
  scheduledAt: string | null;
  campaign: string | null;
  mediaIds: string[];
  targets: { channelId: string; bodyOverride: string | null; firstComment: string | null; options: Record<string, unknown>; status: string }[];
};

type TargetState = { channelId: string; bodyOverride: string | null; firstComment: string; options: Record<string, unknown> };

export function Composer({
  brands, channelsByBrand, mediaByBrand, platforms, post, initialBrandId, initialDate, canApprove, sidebarExtras, master,
  campaignsByBrand = {}, initialCampaign, templatesByBrand = {},
}: {
  brands: ComposerBrand[];
  channelsByBrand: Record<string, ComposerChannel[]>;
  mediaByBrand: Record<string, ComposerMedia[]>;
  platforms: PlatformMeta[];
  post?: ComposerPost;
  initialBrandId?: string;
  initialDate?: string;
  canApprove: boolean;
  /** Extra cards for the right column — status and review on the detail page. */
  sidebarExtras?: ReactNode;
  /** Set when this post is a brand copy: the master values each field follows. */
  master?: MasterValues;
  /** Each brand's campaign names, offered in the campaign field. */
  campaignsByBrand?: Record<string, string[]>;
  initialCampaign?: string;
  /** Templates a post in each brand can start from. */
  templatesByBrand?: Record<string, TemplateOption[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [brandId, setBrandId] = useState(post ? initialBrandId! : initialBrandId ?? brands[0]?.id ?? "");
  const brand = brands.find((b) => b.id === brandId);
  const channels = channelsByBrand[brandId] ?? [];
  const [library, setLibrary] = useState<ComposerMedia[]>(mediaByBrand[brandId] ?? []);

  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<{ note: string; issues: string[] } | null>(null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [campaign, setCampaign] = useState(post?.campaign ?? initialCampaign ?? "");
  const [postType, setPostType] = useState<string | null>(null);
  const [mediaIds, setMediaIds] = useState<string[]>(post?.mediaIds ?? []);
  const [when, setWhen] = useState(
    post?.scheduledAt
      ? toLocalInput(post.scheduledAt, brand?.timezone ?? "UTC")
      : initialDate
        ? `${initialDate}T09:00`
        : "",
  );
  const [targets, setTargets] = useState<TargetState[]>(
    post?.targets.map((t) => ({
      channelId: t.channelId, bodyOverride: t.bodyOverride, firstComment: t.firstComment ?? "", options: t.options ?? {},
    })) ?? [],
  );
  const [activeTab, setActiveTab] = useState<string | null>(post?.targets[0]?.channelId ?? null);

  const metaFor = (platform: string) => platforms.find((p) => p.id === platform)!;
  const selectedMedia = useMemo(
    () => mediaIds.map((id) => library.find((m) => m.id === id)).filter(Boolean) as ComposerMedia[],
    [mediaIds, library],
  );

  // Per-field: does this brand copy still match its master?
  const tz = brand?.timezone ?? "UTC";
  const differs = master && {
    title: title !== master.title,
    body: body !== master.body,
    campaign: campaign !== master.campaign,
    scheduledAt: when !== toLocalInput(master.scheduledAt || null, tz),
    media: JSON.stringify(mediaIds) !== master.media,
  };
  const followTag = (field: keyof NonNullable<typeof differs>, reset: () => void) =>
    differs ? <MasterTag customised={differs[field]} onReset={reset} /> : null;

  const publishedTargets = new Set(post?.targets.filter((t) => t.status === "published").map((t) => t.channelId) ?? []);

  function toggleChannel(channel: ComposerChannel) {
    if (publishedTargets.has(channel.id)) return;
    setTargets((prev) => {
      const exists = prev.some((t) => t.channelId === channel.id);
      if (exists) {
        const next = prev.filter((t) => t.channelId !== channel.id);
        if (activeTab === channel.id) setActiveTab(next[0]?.channelId ?? null);
        return next;
      }
      const meta = metaFor(channel.platform);
      const options = {
        ...Object.fromEntries(
          meta.optionFields.filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue!]),
        ),
        // Saved on the channel, so a SendGrid list id or a subreddit is typed
        // once rather than on every post.
        ...channel.settings,
      };
      setActiveTab(channel.id);
      return [...prev, { channelId: channel.id, bodyOverride: null, firstComment: "", options }];
    });
  }

  function patchTarget(channelId: string, patch: Partial<TargetState>) {
    setTargets((prev) => prev.map((t) => (t.channelId === channelId ? { ...t, ...patch } : t)));
  }

  const validation = targets.map((t) => {
    const channel = channels.find((c) => c.id === t.channelId);
    const meta = channel ? metaFor(channel.platform) : null;
    return {
      channelId: t.channelId,
      issues: meta ? quickValidate(meta, { body: t.bodyOverride ?? body, media: selectedMedia, options: t.options }) : [],
    };
  });
  const errorCount = validation.reduce((n, v) => n + v.issues.filter((i) => i.level === "error").length, 0);

  // Brand-book checks run over the base copy and every per-channel override, so
  // a banned word slipped into one platform tab still gets flagged.
  const allCopy = [body, ...targets.map((t) => t.bodyOverride ?? "")].join("\n");
  const bannedHits = findBannedWords(allCopy, brand?.bannedWords ?? []);
  const emojiHit = brand?.emojiPolicy === "none" && /\p{Extended_Pictographic}/u.test(allCopy);
  // Template prompts nobody replaced yet, anywhere they could be published.
  const holes = findPlaceholders([title, allCopy, ...targets.map((t) => t.firstComment)].join("\n"));
  const templates = templatesByBrand[brandId] ?? [];

  /**
   * Fills the editor from a template: title, body (with its hashtags), the
   * brand's channels on the template's platforms, and the first comment where
   * the platform takes one. Nothing is saved until the writer saves.
   */
  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const hasCopy = body.trim() || targets.some((x) => x.bodyOverride?.trim());
    if (hasCopy && !confirm(`Replace the copy in the editor with the "${t.name}" template? Nothing is saved until you save.`)) return;
    setTitle(t.title || title);
    setBody(t.hashtags.length ? `${t.body.replace(/\s+$/, "")}\n\n${t.hashtags.join(" ")}` : t.body);
    setPostType(t.postType);
    const add = channels.filter((c) => t.platforms.includes(c.platform) && !targets.some((x) => x.channelId === c.id));
    for (const c of add) toggleChannel(c);
    // Per-channel rewrites belonged to the old copy; start every channel from the template.
    setTargets((prev) => prev.map((x) => {
      const c = channels.find((ch) => ch.id === x.channelId);
      const takesComment = t.firstComment && c && metaFor(c.platform).constraints.supportsFirstComment;
      return { ...x, bodyOverride: null, ...(takesComment ? { firstComment: t.firstComment! } : {}) };
    }));
  }

  /** Brand-book one-click inserts (hashtags, CTA) append to the base copy. */
  function appendToBody(text: string) {
    setBody((b) => (b.trim() ? b.replace(/\s+$/, "") + "\n\n" + text : text));
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length || !brandId) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await uploadMediaAction(brandId, fd);
      if (!res.ok) { setError(res.error); return; }
      const { ids } = res;
      // Optimistically show what we just added without a round trip.
      const added = Array.from(files).map((f, i) => ({
        id: ids[i], url: URL.createObjectURL(f),
        kind: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "document",
        originalName: f.name,
      }));
      setLibrary((prev) => [...added, ...prev]);
      setMediaIds((prev) => [...prev, ...ids]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function save(intent: PostInput["intent"]) {
    setError(null);
    const scheduledAt = when && brand ? fromLocalInput(when, brand.timezone)?.toISOString() ?? null : null;
    const input: PostInput = {
      brandId, postId: post?.id, title, body, scheduledAt, campaign: campaign || null,
      tags: [], mediaIds, postType: postType ?? undefined,
      targets: targets.map((t) => ({
        channelId: t.channelId,
        bodyOverride: t.bodyOverride,
        firstComment: t.firstComment || null,
        options: t.options,
      })),
      intent,
    };
    start(async () => {
      try {
        const res = await savePostAction(input);
        if (!res.ok) { setError(res.error); return; }
        router.push(`/posts/${res.postId}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  const activeTarget = targets.find((t) => t.channelId === activeTab);
  const activeChannel = channels.find((c) => c.id === activeTab);
  const activeMeta = activeChannel ? metaFor(activeChannel.platform) : null;
  const activeIssues = validation.find((v) => v.channelId === activeTab)?.issues ?? [];

  /**
   * Fills the editor with Claude's draft — base copy plus one override per
   * ticked channel. Nothing is saved until the writer saves, so a bad draft
   * costs one click of Undo-by-reload, not their work.
   */
  async function draftWithClaude() {
    const hasCopy = body.trim() || targets.some((t) => t.bodyOverride?.trim());
    if (hasCopy && !confirm("Replace the copy in the editor with Claude's draft? Nothing is saved until you save.")) return;
    setDrafting(true);
    setError(null);
    setDraftNote(null);
    try {
      const res = await generateDraftAction({
        brandId, postId: post?.id ?? null, ideaId: post?.ideaId ?? null,
        title, body, channelIds: targets.map((t) => t.channelId),
      });
      if (!res.ok) { setError(res.error); return; }
      const { draft } = res;
      if (!title.trim()) setTitle(draft.title);
      setBody(draft.body);
      setTargets((prev) => prev.map((t) => {
        const v = draft.channels.find((c) => c.channelId === t.channelId);
        if (!v) return t;
        const meta = metaFor(channels.find((c) => c.id === t.channelId)?.platform ?? "");
        return {
          ...t,
          bodyOverride: v.body,
          firstComment: meta?.constraints.supportsFirstComment && v.firstComment ? v.firstComment : t.firstComment,
        };
      }));
      setDraftNote({ note: draft.note, issues: res.issues });
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            title="The post"
            subtitle={brand?.brief ? brand.brief : "Write once, then tune it per platform below."}
            action={
              <div className="flex items-center gap-2">
                {templates.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { applyTemplate(e.target.value); e.target.value = ""; }}
                    className="!w-40 !py-1 !text-xs"
                    aria-label="Start from a template"
                  >
                    <option value="">Start from template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{t.fromMaster ? " (master)" : ""}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={draftWithClaude}
                  disabled={drafting || pending || !brandId}
                  className={buttonClass("subtle", "sm")}
                  title={targets.length === 0
                    ? "Drafts the base copy. Tick channels first to get a version for each."
                    : `Drafts the base copy and a version for each of ${targets.length} channel${targets.length === 1 ? "" : "s"}.`}
                >
                  {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {drafting ? "Drafting…" : "Draft with Claude"}
                </button>
              {!post && brands.length > 1 ? (
                <select
                  value={brandId}
                  onChange={(e) => {
                    setBrandId(e.target.value);
                    setTargets([]);
                    setMediaIds([]);
                    setActiveTab(null);
                    setLibrary(mediaByBrand[e.target.value] ?? []);
                  }}
                  className="w-44"
                >
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              ) : null}
              </div>
            }
          />
          <div className="space-y-3 p-4">
            <Field label={<LabelRow text="Internal title" tag={followTag("title", () => setTitle(master!.title))} />}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch teaser — week 3" />
            </Field>
            <Field
              label={<LabelRow text="Base copy" tag={followTag("body", () => setBody(master!.body))} />}
              hint={master ? "Starts as the master copy. Rewrite it for this brand; untouched copy keeps following the master." : "Each channel starts from this and can override it."}
            >
              <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What do you want to say?" />
            </Field>
            {draftNote && (
              <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs">
                <p className="flex items-start gap-1.5">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span><span className="font-medium">Claude&apos;s note:</span> {draftNote.note} Review it, then save.</span>
                </p>
                {draftNote.issues.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 pl-5 text-warn">
                    {draftNote.issues.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <div className="min-w-40 flex-1">
                <Field label={<LabelRow text="Campaign (optional)" tag={followTag("campaign", () => setCampaign(master!.campaign))} />}>
                  <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Q4 launch" list="composer-campaigns" />
                  <datalist id="composer-campaigns">
                    {(campaignsByBrand[brandId] ?? []).map((n) => <option key={n} value={n} />)}
                  </datalist>
                </Field>
              </div>
              <div className="min-w-52 flex-1">
                <Field label={<LabelRow text={`Publish at (${tz})`} tag={followTag("scheduledAt", () => setWhen(toLocalInput(master!.scheduledAt || null, tz)))} />}>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Media"
            subtitle={<span className="flex items-center gap-2">{selectedMedia.length} attached {followTag("media", () => setMediaIds(JSON.parse(master!.media)))}</span>}
            action={
              <label className={`${buttonClass("subtle", "sm")} cursor-pointer`}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload
                <input type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />
              </label>
            }
          />
          <div className="p-4">
            {selectedMedia.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedMedia.map((m, i) => (
                  <div key={m.id} className="relative">
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" className="size-20 rounded-lg border border-border object-cover" />
                    ) : (
                      <div className="grid size-20 place-items-center rounded-lg border border-border bg-surface-2 p-1 text-center text-[10px]">
                        {m.originalName.slice(0, 18)}
                      </div>
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                    <button
                      onClick={() => setMediaIds((prev) => prev.filter((id) => id !== m.id))}
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-surface ring-1 ring-border hover:text-danger"
                      title="Remove"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="mb-2 text-xs text-muted">Library</p>
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {library.filter((m) => !mediaIds.includes(m.id)).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMediaIds((prev) => [...prev, m.id])}
                  className="group relative size-16 overflow-hidden rounded-lg border border-border"
                  title={m.originalName}
                >
                  {m.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center bg-surface-2 p-1 text-[10px]">{m.kind}</span>
                  )}
                  {m.isMaster && (
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] font-medium text-white" title="Master asset">Master</span>
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <Plus className="size-4 text-white" />
                  </span>
                </button>
              ))}
              {library.length === 0 && <p className="py-4 text-sm text-muted">Nothing in this brand&apos;s library yet.</p>}
            </div>
          </div>
        </Card>

        {activeTarget && activeChannel && activeMeta && (
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <PlatformIcon platform={activeChannel.platform} size={16} />
                  {activeMeta.name} · {activeChannel.handle}
                </span>
              }
              subtitle={activeMeta.constraints.aspectRatioHint}
              action={
                <span className={`text-xs tabular-nums ${
                  (activeTarget.bodyOverride ?? body).length > activeMeta.constraints.textMax ? "text-danger" : "text-muted"
                }`}>
                  {(activeTarget.bodyOverride ?? body).length} / {activeMeta.constraints.textMax}
                </span>
              }
            />
            <div className="space-y-3 p-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">Copy for {activeMeta.name}</span>
                  {activeTarget.bodyOverride === null ? (
                    <button
                      onClick={() => patchTarget(activeChannel.id, { bodyOverride: body })}
                      className="text-xs text-accent hover:underline"
                    >
                      Customise for this channel
                    </button>
                  ) : (
                    <button
                      onClick={() => patchTarget(activeChannel.id, { bodyOverride: null })}
                      className="text-xs text-muted hover:underline"
                    >
                      Reset to base copy
                    </button>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={activeTarget.bodyOverride ?? body}
                  readOnly={activeTarget.bodyOverride === null}
                  onChange={(e) => patchTarget(activeChannel.id, { bodyOverride: e.target.value })}
                  className={activeTarget.bodyOverride === null ? "opacity-70" : ""}
                />
              </div>

              {activeMeta.constraints.supportsFirstComment && (
                <Field label="First comment" hint="Posted straight after — handy for hashtags and links.">
                  <textarea
                    rows={2}
                    value={activeTarget.firstComment}
                    onChange={(e) => patchTarget(activeChannel.id, { firstComment: e.target.value })}
                  />
                </Field>
              )}

              {activeMeta.optionFields.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeMeta.optionFields.map((f) => {
                    const value = activeTarget.options[f.key];
                    const set = (v: unknown) => patchTarget(activeChannel.id, { options: { ...activeTarget.options, [f.key]: v } });
                    return (
                      <Field key={f.key} label={f.label + (f.required ? " *" : "")} hint={f.type === "boolean" ? undefined : f.help}>
                        {f.type === "select" ? (
                          <select value={String(value ?? "")} onChange={(e) => set(e.target.value)}>
                            {f.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        ) : f.type === "boolean" ? (
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} className="size-4" />
                            <span className="text-muted">{f.help ?? "Yes"}</span>
                          </label>
                        ) : f.type === "textarea" ? (
                          <textarea rows={2} value={String(value ?? "")} onChange={(e) => set(e.target.value)} />
                        ) : (
                          <input
                            type={f.type === "number" ? "number" : "text"}
                            value={String(value ?? "")}
                            placeholder={f.placeholder}
                            onChange={(e) => set(e.target.value)}
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              )}

              {activeIssues.length > 0 && (
                <ul className="space-y-1">
                  {activeIssues.map((i, n) => (
                    <li key={n} className={`flex items-start gap-1.5 text-xs ${i.level === "error" ? "text-danger" : "text-warn"}`}>
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        {sidebarExtras}

        {brand && <BrandBook brand={brand} onInsert={appendToBody} />}

        <Card>
          <CardHeader title="Channels" subtitle={`${targets.length} of ${channels.length} selected`} />
          <div className="space-y-1 p-3">
            {channels.length === 0 && (
              <p className="px-1 py-3 text-sm text-muted">
                No channels on this brand yet. Add them under Channels.
              </p>
            )}
            {channels.map((c) => {
              const on = targets.some((t) => t.channelId === c.id);
              const issues = validation.find((v) => v.channelId === c.id)?.issues ?? [];
              const bad = issues.some((i) => i.level === "error");
              const locked = publishedTargets.has(c.id);
              const meta = metaFor(c.platform);
              return (
                <div key={c.id} className="flex items-center gap-2">
                  <button
                    onClick={() => toggleChannel(c)}
                    disabled={locked}
                    // Selected rows pick up the platform's own colour rather than
                    // one shared accent, so a nine-channel list stays scannable.
                    style={on ? { borderColor: tintedBorder(meta.color), background: tintedSurface(meta.color) } : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      on ? "" : "border-border hover:bg-surface-2"
                    } ${locked ? "opacity-60" : ""}`}
                  >
                    <PlatformIcon platform={c.platform} size={26} className={on ? "" : "opacity-85"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-tight">{c.handle}</span>
                      <span className="block truncate text-[11px] leading-tight text-muted">{meta.name}</span>
                    </span>
                    {c.mode === "live" && <Zap className="size-3 shrink-0 text-ok" aria-label="Publishes automatically" />}
                    {on && <Check className="size-3.5 shrink-0" style={{ color: tintedInk(meta.color) }} />}
                  </button>
                  {on && (
                    <button
                      onClick={() => setActiveTab(c.id)}
                      className={`rounded-md px-1.5 py-1 text-[11px] ${
                        activeTab === c.id ? "bg-accent text-accent-fg" : bad ? "text-danger" : "text-muted hover:bg-surface-2"
                      }`}
                      title="Tune this channel"
                    >
                      {bad ? <AlertCircle className="size-3.5" /> : "edit"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Publish" />
          <div className="space-y-2 p-3">
            {error && (
              <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>
            )}
            {errorCount > 0 && (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                {errorCount} issue{errorCount === 1 ? "" : "s"} to fix before scheduling.
              </p>
            )}
            {bannedHits.length > 0 && (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                Off-brand wording: {bannedHits.join(", ")}.
              </p>
            )}
            {holes.length > 0 && (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                Fill in the template first: {holes.join(", ")}. Drafts can be saved; scheduling waits until they are gone.
              </p>
            )}
            {emojiHit && (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                {brand?.name} does not use emoji.
              </p>
            )}

            <button onClick={() => save("draft")} disabled={pending} className={`${buttonClass("subtle")} w-full`}>
              Save draft
            </button>
            <button onClick={() => save("review")} disabled={pending} className={`${buttonClass("subtle")} w-full`}>
              Submit for approval
            </button>
            <button
              onClick={() => save("schedule")}
              disabled={pending || errorCount > 0 || holes.length > 0 || !when || targets.length === 0}
              className={`${buttonClass("primary")} w-full`}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Schedule
            </button>
            {canApprove && (
              <button
                onClick={() => save("publish_now")}
                disabled={pending || errorCount > 0 || holes.length > 0 || targets.length === 0}
                className={`${buttonClass("subtle")} w-full`}
              >
                Publish now
              </button>
            )}
            <p className="pt-1 text-[11px] leading-relaxed text-muted">
              Live channels post by themselves at the scheduled time. Manual channels land in the publish queue with the
              copy and files ready to go.
            </p>
          </div>
        </Card>

        {post && (
          <button
            onClick={() => {
              if (confirm("Delete this post? This cannot be undone.")) {
                start(async () => {
                  const { deletePostAction } = await import("@/server/actions/posts");
                  const res = await deletePostAction(post.id);
                  if (!res.ok) setError(res.error);
                });
              }
            }}
            className={`${buttonClass("danger")} w-full`}
          >
            <Trash2 className="size-4" /> Delete post
          </button>
        )}
      </div>
    </div>
  );
}

