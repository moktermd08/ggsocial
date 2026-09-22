"use client";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Layers, Loader2, Plus, Trash2, X } from "lucide-react";
import { PlatformIcon } from "./platform-icon";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import { toLocalInput, fromLocalInput } from "@/lib/format";
import { saveMasterAction, deleteMasterAction } from "@/server/actions/masters";
import type { TemplateOption } from "@/lib/templates";

export type MasterEditorMedia = { id: string; url: string; kind: string; originalName: string; brandColor: string; brandName: string };
export type MasterEditorBrand = { id: string; name: string; color: string; canEdit: boolean };
export type MasterEditorPlatform = { id: string; name: string; color: string };
export type MasterEditorPost = {
  id: string; title: string; body: string; campaign: string | null; tags: string[];
  scheduledAt: string | null; mediaIds: string[]; platforms: string[];
  guidelines: string | null; notes: string | null;
};

/**
 * The master copy: written once, above the brands. Saving it creates the brand
 * copies (for a new master) or updates every copy that still follows it.
 */
export function MasterEditor({
  master, brands, media, platforms, timezone, canEdit, sidebar, campaignOptions = [], initialCampaign, templates = [],
}: {
  master?: MasterEditorPost;
  /** Brands a new master can be copied into. Ignored once it exists. */
  brands: MasterEditorBrand[];
  media: MasterEditorMedia[];
  /** Platforms the brands have channels on. */
  platforms: MasterEditorPlatform[];
  /** Zone the suggested publish time is typed in. */
  timezone: string;
  canEdit: boolean;
  sidebar?: ReactNode;
  /** Master campaign names, offered in the campaign field. */
  campaignOptions?: string[];
  initialCampaign?: string;
  /** Master templates a new master post can start from. */
  templates?: TemplateOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [title, setTitle] = useState(master?.title ?? "");
  const [body, setBody] = useState(master?.body ?? "");
  const [guidelines, setGuidelines] = useState(master?.guidelines ?? "");
  const [notes, setNotes] = useState(master?.notes ?? "");
  const [campaign, setCampaign] = useState(master?.campaign ?? initialCampaign ?? "");
  const [tags, setTags] = useState((master?.tags ?? []).join(", "));
  const [when, setWhen] = useState(toLocalInput(master?.scheduledAt ?? null, timezone));
  const [mediaIds, setMediaIds] = useState<string[]>(master?.mediaIds ?? []);
  const [picked, setPicked] = useState<string[]>(master?.platforms ?? []);
  const [brandIds, setBrandIds] = useState<string[]>(brands.filter((b) => b.canEdit).map((b) => b.id));

  const selected = useMemo(
    () => mediaIds.map((id) => media.find((m) => m.id === id)).filter(Boolean) as MasterEditorMedia[],
    [mediaIds, media],
  );

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (body.trim() && !confirm(`Replace the copy with the "${t.name}" template? Nothing is saved until you save.`)) return;
    if (t.title) setTitle(t.title);
    setBody(t.hashtags.length ? `${t.body.replace(/\s+$/, "")}\n\n${t.hashtags.join(" ")}` : t.body);
    if (t.platforms.length) setPicked(t.platforms);
  }

  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  function save() {
    setError(null);
    setSaved(null);
    start(async () => {
      try {
        const res = await saveMasterAction({
          masterId: master?.id,
          title, body, campaign: campaign || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          scheduledAt: when ? fromLocalInput(when, timezone)?.toISOString() ?? null : null,
          mediaIds, platforms: picked,
          guidelines: guidelines || null, notes: notes || null,
          brandIds: master ? undefined : brandIds,
        });
        if (!master) {
          router.push(`/posts/master/${res.masterId}`);
        } else {
          setSaved(res.synced ? `Saved. ${res.synced} brand cop${res.synced === 1 ? "y" : "ies"} checked for updates.` : "Saved.");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  const readOnly = !canEdit;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            icon={Layers}
            title="Master copy"
            subtitle="Every brand starts from this. Fields a brand has not changed keep following it."
            action={templates.length > 0 && canEdit ? (
              <select
                value=""
                onChange={(e) => { applyTemplate(e.target.value); e.target.value = ""; }}
                className="!w-44 !py-1 !text-xs"
                aria-label="Start from a template"
              >
                <option value="">Start from template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : undefined}
          />
          <fieldset disabled={readOnly} className="space-y-3 p-4">
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Autumn launch — teaser" />
            </Field>
            <Field label="Copy" hint="Brand copies inherit this. Each brand can rewrite it in its own voice.">
              <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What do you want to say?" />
            </Field>
            <Field
              label="Guidelines for brands"
              hint="How to adapt this piece: what must stay, what each brand should change. Shown beside every copy."
            >
              <textarea
                rows={3}
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
                placeholder="Keep the stat and the link. Moksy AI leads with the product; Guru Graphics with the design angle."
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-40 flex-1">
                <Field label="Campaign (optional)">
                  <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Q4 launch" list="master-campaigns" />
                  <datalist id="master-campaigns">
                    {campaignOptions.map((n) => <option key={n} value={n} />)}
                  </datalist>
                </Field>
              </div>
              <div className="min-w-40 flex-1">
                <Field label="Tags" hint="Comma separated.">
                  <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="launch, ai" />
                </Field>
              </div>
              <div className="min-w-52 flex-1">
                <Field label={`Suggested publish time (${timezone})`}>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </div>
            </div>
            <Field label="Internal notes" hint="Never published. Visible to everyone on the brands this reaches.">
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </fieldset>
        </Card>

        <Card>
          <CardHeader title="Media" subtitle={`${selected.length} attached · picked from any brand's library`} />
          <div className="p-4">
            {selected.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selected.map((m, i) => (
                  <div key={m.id} className="relative">
                    <Thumb m={m} className="size-20" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                    {!readOnly && (
                      <button
                        onClick={() => setMediaIds((prev) => prev.filter((id) => id !== m.id))}
                        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-surface ring-1 ring-border hover:text-danger"
                        title="Remove"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!readOnly && (
              <>
                <p className="mb-2 text-xs text-muted">Libraries — upload new files under Media, then pick them here.</p>
                <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                  {media.filter((m) => !mediaIds.includes(m.id)).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMediaIds((prev) => [...prev, m.id])}
                      className="group relative size-16 overflow-hidden rounded-lg border border-border"
                      title={`${m.originalName} · ${m.brandName}`}
                    >
                      <Thumb m={m} className="size-full" />
                      <span className="absolute bottom-1 left-1 size-2 rounded-full ring-1 ring-white" style={{ background: m.brandColor }} />
                      <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        <Plus className="size-4 text-white" />
                      </span>
                    </button>
                  ))}
                  {media.length === 0 && <p className="py-4 text-sm text-muted">No media in any library yet.</p>}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        {sidebar}

        {!master && (
          <Card>
            <CardHeader title="Create copies in" subtitle="One linked draft per brand." />
            <div className="space-y-1 p-3">
              {brands.map((b) => {
                const on = brandIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    disabled={!b.canEdit}
                    onClick={() => setBrandIds((prev) => toggle(prev, b.id))}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left text-sm transition-colors ${
                      on ? "border-accent/50 bg-accent-soft" : "border-border hover:bg-surface-2"
                    } ${b.canEdit ? "" : "opacity-50"}`}
                    title={b.canEdit ? undefined : "You need editor access on this brand."}
                  >
                    <span className="size-4 shrink-0 rounded" style={{ background: b.color }} />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {on && <Check className="size-3.5 text-accent" />}
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Platforms"
            subtitle={master ? "New copies are pointed at these channels." : "Each copy gets that brand's channels on these."}
          />
          <div className="flex flex-wrap gap-1.5 p-3">
            {platforms.length === 0 && <p className="px-1 py-2 text-sm text-muted">No channels connected on any brand yet.</p>}
            {platforms.map((p) => {
              const on = picked.includes(p.id);
              return (
                <button
                  key={p.id}
                  disabled={readOnly}
                  onClick={() => setPicked((prev) => toggle(prev, p.id))}
                  style={on ? { borderColor: tintedBorder(p.color), background: tintedSurface(p.color), color: tintedInk(p.color) } : undefined}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${on ? "" : "border-border text-muted hover:bg-surface-2"}`}
                >
                  <PlatformIcon platform={p.id} size={16} /> {p.name}
                </button>
              );
            })}
          </div>
        </Card>

        {canEdit && (
          <Card>
            <CardHeader title={master ? "Save" : "Create"} />
            <div className="space-y-2 p-3">
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
              {saved && <p className="rounded-lg border border-ok/40 bg-ok/10 px-2.5 py-2 text-xs text-ok">{saved}</p>}
              <button
                onClick={save}
                disabled={pending || (!title.trim() && !body.trim())}
                className={`${buttonClass("primary")} w-full`}
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {master ? "Save master" : `Create master${brandIds.length ? ` + ${brandIds.length} cop${brandIds.length === 1 ? "y" : "ies"}` : ""}`}
              </button>
              <p className="pt-1 text-[11px] leading-relaxed text-muted">
                {master
                  ? "Copies still in draft or review pick up changes to fields they haven't customised. Approved or scheduled copies are asked first."
                  : "Each brand gets a linked draft. Brands edit their own copy, then review and schedule it as usual."}
              </p>
            </div>
          </Card>
        )}

        {master && canEdit && (
          <button
            onClick={() => {
              if (confirm("Delete this master? Its brand copies stay, as ordinary posts.")) {
                start(async () => { await deleteMasterAction(master.id); });
              }
            }}
            className={`${buttonClass("danger")} w-full`}
          >
            <Trash2 className="size-4" /> Delete master
          </button>
        )}
      </div>
    </div>
  );
}

function Thumb({ m, className }: { m: { url: string; kind: string; originalName: string }; className: string }) {
  return m.kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} alt="" className={`${className} rounded-lg border border-border object-cover`} />
  ) : (
    <div className={`${className} grid place-items-center rounded-lg border border-border bg-surface-2 p-1 text-center text-[10px]`}>
      {m.originalName.slice(0, 18)}
    </div>
  );
}
