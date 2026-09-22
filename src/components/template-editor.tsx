"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, FileText, Layers, Loader2 } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { LabelRow, MasterTag } from "./master-panels";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import { parseHashtags } from "@/lib/campaigns";
import {
  POST_TYPES, TEMPLATE_FIELDS, findPlaceholders, type TemplateField, type TemplateValues,
} from "@/lib/templates";
import { archiveTemplateAction, saveTemplateAction } from "@/server/actions/templates";
import { isFailure } from "@/lib/action-result";

export type TemplateEditorTemplate = { id: string; brandId: string | null; values: TemplateValues; notes: string | null };

const EMPTY = Object.fromEntries(
  TEMPLATE_FIELDS.map((f) => [f, f === "platforms" || f === "hashtags" ? "[]" : ""]),
) as TemplateValues;

const parseList = (v: string) => JSON.parse(v || "[]") as string[];

/**
 * One post template. Serves a master template, a brand's linked copy (with a
 * Customised/From master marker per field) and a template only one brand uses.
 */
export function TemplateEditor({
  template, master, where, defaultWhere, copyBrands, platforms, canEdit, sidebar,
}: {
  template?: TemplateEditorTemplate;
  master?: TemplateValues;
  where?: { value: string; label: string; color?: string }[];
  defaultWhere?: string;
  copyBrands?: { id: string; name: string; color: string }[];
  platforms: { id: string; name: string; color: string }[];
  canEdit: boolean;
  sidebar?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [values, setValues] = useState<TemplateValues>(template?.values ?? EMPTY);
  const [hashtagText, setHashtagText] = useState(parseList(values.hashtags).join(" "));
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [target, setTarget] = useState(defaultWhere ?? where?.[0]?.value ?? "master");
  // Unticked by default: every brand can use a master template without a copy.
  const [copyIds, setCopyIds] = useState<string[]>([]);

  const set = (f: TemplateField, v: string) => setValues((prev) => ({ ...prev, [f]: v }));
  const current: TemplateValues = { ...values, hashtags: JSON.stringify(parseHashtags(hashtagText)) };
  const picked = parseList(values.platforms);
  const placeholders = findPlaceholders(`${values.title}\n${values.body}\n${values.firstComment}`);

  const tag = (f: TemplateField) => master
    ? (
      <MasterTag
        customised={current[f] !== master[f]}
        onReset={() => (f === "hashtags" ? setHashtagText(parseList(master.hashtags).join(" ")) : set(f, master[f]))}
      />
    )
    : null;

  function save() {
    setError(null);
    setSaved(null);
    start(async () => {
      try {
        const res = await saveTemplateAction({
          id: template?.id,
          brandId: template ? undefined : target === "master" ? null : target,
          values: current,
          notes: notes || null,
          copyBrandIds: !template && target === "master" ? copyIds : undefined,
        });
        if (!res.ok) { setError(res.error); return; }
        if (!template) router.push(`/templates/${res.id}`);
        else {
          setSaved(res.synced ? `Saved. ${res.synced} brand cop${res.synced === 1 ? "y" : "ies"} checked for updates.` : "Saved.");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  const isMaster = template ? template.brandId === null : target === "master";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            icon={isMaster ? Layers : FileText}
            title="The template"
            subtitle="Write the shape of the post. Put the parts a writer fills in inside [Square brackets starting with a capital]."
          />
          <fieldset disabled={!canEdit} className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={<LabelRow text="Name" tag={tag("name")} />}>
                <input value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Client win case study" />
              </Field>
              <Field label={<LabelRow text="Post type" tag={tag("postType")} />}>
                <input value={values.postType} onChange={(e) => set("postType", e.target.value)} list="template-post-types" placeholder="Case study" />
                <datalist id="template-post-types">{POST_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              </Field>
            </div>
            <Field label={<LabelRow text="When to use it" tag={tag("description")} />}>
              <input value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="After a project ships and the client has agreed to be named." />
            </Field>
            <Field label={<LabelRow text="Title" tag={tag("title")} />} hint="The internal title posts start with.">
              <input value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="Case study — [Client name]" />
            </Field>
            <Field label={<LabelRow text="Body" tag={tag("body")} />}>
              <textarea
                rows={10}
                value={values.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder={"[Hook: the result in one line]\n\n[Client name] came to us with [the problem].\n\nWhat we did:\n→ [Step one]\n→ [Step two]\n\n[The outcome, with a number]"}
              />
            </Field>
            {placeholders.length > 0 && (
              <p className="flex flex-wrap gap-1 text-[11px] text-muted">
                <span>{placeholders.length} placeholder{placeholders.length === 1 ? "" : "s"}:</span>
                {placeholders.map((p) => <span key={p} className="rounded bg-accent-soft px-1 text-accent">{p}</span>)}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={<LabelRow text="Hashtags" tag={tag("hashtags")} />} hint="Separated by spaces or commas.">
                <input value={hashtagText} onChange={(e) => setHashtagText(e.target.value)} placeholder="#casestudy" />
              </Field>
              <Field label={<LabelRow text="First comment" tag={tag("firstComment")} />} hint="Where the platform supports one.">
                <input value={values.firstComment} onChange={(e) => set("firstComment", e.target.value)} placeholder="Full write-up: [Link]" />
              </Field>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted"><LabelRow text="Platforms it suits" tag={tag("platforms")} /></div>
              <div className="flex flex-wrap gap-1.5">
                {platforms.length === 0 && <p className="text-sm text-muted">No channels connected yet.</p>}
                {platforms.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set("platforms", JSON.stringify(on ? picked.filter((x) => x !== p.id) : [...picked, p.id]))}
                      style={on ? { borderColor: tintedBorder(p.color), background: tintedSurface(p.color), color: tintedInk(p.color) } : undefined}
                      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${on ? "" : "border-border text-muted hover:bg-surface-2"}`}
                    >
                      <PlatformIcon platform={p.id} size={16} /> {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Internal notes" hint={master ? "This brand's own notes. Never inherited." : "Never published."}>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </fieldset>
        </Card>
      </div>

      <div className="space-y-5">
        {sidebar}

        {!template && where && where.length > 1 && (
          <Card>
            <CardHeader title="Where" subtitle="A master template, or one brand's own." />
            <div className="space-y-1 p-3">
              {where.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setTarget(w.value)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
                    target === w.value ? "border-accent/50 bg-accent-soft" : "border-border hover:bg-surface-2"
                  }`}
                >
                  {w.value === "master"
                    ? <span className="grid size-4 place-items-center rounded bg-text text-surface"><Layers className="size-2.5" /></span>
                    : <span className="size-4 rounded" style={{ background: w.color }} />}
                  <span className="flex-1">{w.label}</span>
                  {target === w.value && <Check className="size-3.5 text-accent" />}
                </button>
              ))}
            </div>
          </Card>
        )}

        {!template && target === "master" && copyBrands && copyBrands.length > 0 && (
          <Card>
            <CardHeader title="Create copies in" subtitle="Optional — brands can use a master template without one." />
            <div className="space-y-1 p-3">
              {copyBrands.map((b) => {
                const on = copyIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => setCopyIds((prev) => on ? prev.filter((x) => x !== b.id) : [...prev, b.id])}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
                      on ? "border-accent/50 bg-accent-soft" : "border-border hover:bg-surface-2"
                    }`}
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

        {canEdit && (
          <Card>
            <CardHeader title={template ? "Save" : "Create"} />
            <div className="space-y-2 p-3">
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
              {saved && <p className="rounded-lg border border-ok/40 bg-ok/10 px-2.5 py-2 text-xs text-ok">{saved}</p>}
              <button onClick={save} disabled={pending || !values.name.trim()} className={`${buttonClass("primary")} w-full`}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {template
                  ? "Save template"
                  : target === "master"
                    ? `Create master${copyIds.length ? ` + ${copyIds.length} cop${copyIds.length === 1 ? "y" : "ies"}` : ""}`
                    : "Create template"}
              </button>
              {isMaster && (
                <p className="pt-1 text-[11px] leading-relaxed text-muted">
                  Every brand can start a post from a master template. A brand copy lets that brand adapt it; copies pick up
                  changes to fields they haven&apos;t customised.
                </p>
              )}
            </div>
          </Card>
        )}

        {template && canEdit && (
          <button
            onClick={() => {
              if (!confirm("Archive this template? Posts made from it are unaffected.")) return;
              setError(null);
              start(async () => {
                const res = await archiveTemplateAction(template.id);
                if (isFailure(res)) setError(res.error);
              });
            }}
            className={`${buttonClass("subtle")} w-full`}
          >
            <Archive className="size-4" /> Archive template
          </button>
        )}
      </div>
    </div>
  );
}
