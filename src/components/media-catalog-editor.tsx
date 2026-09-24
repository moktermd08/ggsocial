"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { Button, Field } from "./ui";
import { catalogueMediaAction, saveMediaCatalogAction } from "@/server/actions/media";
import { MEDIA_USES, orientationOf } from "@/lib/media-catalog";
import type { MediaRow } from "./media-library";

type Form = {
  altText: string; category: string; subcategory: string;
  tags: string[]; uses: string[]; usageNotes: string;
};

const formOf = (m: MediaRow): Form => ({
  altText: m.altText ?? "", category: m.category ?? "", subcategory: m.subcategory ?? "",
  tags: m.tags ?? [], uses: m.uses ?? [], usageNotes: m.usageNotes ?? "",
});

/** Keywords as chips: type, then Enter or a comma. Pasting a list splits it. */
function KeywordInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add(text: string) {
    const next = text.split(/[,\n]/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean);
    if (next.length) onChange([...new Set([...value, ...next])]);
    setDraft("");
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5">
      {value.map((t) => (
        <span key={t} className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-muted hover:text-danger" aria-label={`Remove ${t}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(draft); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? "" : "e.g. coffee, morning, flat lay"}
        className="min-w-24 flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus:ring-0"
      />
    </div>
  );
}

/**
 * Files one library item: what it shows, its shelf, keywords, where it suits
 * and when not to use it. Steps through the files on screen, so a fresh
 * import can be checked one after another. Keyed by file, so each opens fresh.
 */
export function MediaCatalogEditor({
  items, index, categories, onIndex, onClose, onSaved,
}: {
  items: MediaRow[];
  index: number;
  categories: { name: string; subcategories: string[] }[];
  onIndex: (i: number) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const m = items[index];
  const [form, setForm] = useState<Form>(() => formOf(m));
  const [busy, setBusy] = useState<"save" | "claude" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof Form>(key: K, v: Form[K]) => { setForm((f) => ({ ...f, [key]: v })); setDirty(true); };
  const editable = m.canCatalog !== false;
  const subs = categories.find((c) => c.name.toLowerCase() === form.category.trim().toLowerCase())?.subcategories ?? [];
  const orientation = orientationOf(m.width, m.height);

  async function save(then?: "next") {
    setBusy("save");
    setError(null);
    try {
      const res = await saveMediaCatalogAction(m.id, form);
      if (!res.ok) { setError(res.error); return; }
      setDirty(false);
      onSaved();
      if (then === "next" && index < items.length - 1) onIndex(index + 1);
      else setNote("Saved.");
    } finally { setBusy(null); }
  }

  async function askClaude() {
    setBusy("claude");
    setError(null);
    setNote(null);
    try {
      const res = await catalogueMediaAction([m.id]);
      if (!res.ok) { setError(res.error); return; }
      const got = res.done[0]?.fields;
      if (!got) { setError(res.failed[0]?.error ?? "Claude could not file this one."); return; }
      setForm({
        altText: got.altText ?? "", category: got.category ?? "", subcategory: got.subcategory ?? "",
        tags: got.tags, uses: got.uses, usageNotes: got.usageNotes ?? "",
      });
      setDirty(false);
      setNote("Claude filed it and it is saved. Change anything that is off, then save again.");
      onSaved();
    } finally { setBusy(null); }
  }

  function go(i: number) {
    if (dirty && !confirm("Leave without saving your changes?")) return;
    onIndex(i);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-label={`File ${m.originalName}`}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={m.originalName}>{m.originalName}</h2>
          <span className="text-xs text-muted">{index + 1} of {items.length}</span>
          <Button size="sm" variant="ghost" disabled={index === 0 || !!busy} onClick={() => go(index - 1)} aria-label="Previous file"><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="ghost" disabled={index >= items.length - 1 || !!busy} onClick={() => go(index + 1)} aria-label="Next file"><ChevronRight className="size-4" /></Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-2">
            <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-border bg-surface-2">
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={form.altText} className="size-full object-contain" />
              ) : m.kind === "video" ? (
                <video src={m.url} className="max-h-full max-w-full" controls muted />
              ) : (
                <span className="text-sm text-muted">{m.originalName.split(".").pop()}</span>
              )}
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {m.width && m.height ? <span>{m.width}×{m.height}px</span> : null}
              {orientation && <span className="capitalize">{orientation}</span>}
              {m.isMaster && <span>Master asset</span>}
              {m.sourceUrl && (
                <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 hover:text-text">
                  Open original <ExternalLink className="size-3" />
                </a>
              )}
            </p>
            {m.catalogedAt && (
              <p className="text-[11px] text-muted">
                Filed {m.catalogedBy === "claude" ? "by Claude" : "by a person"} on {new Date(m.catalogedAt).toLocaleDateString()}
              </p>
            )}
            {!editable && (
              <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
                This is a master asset. Its owner files it in the Master library.
              </p>
            )}
          </div>

          <fieldset disabled={!editable || !!busy} className="space-y-3">
            <Field label="What it shows" hint="Used as alt text, and read first by search.">
              <textarea rows={2} value={form.altText} onChange={(e) => set("altText", e.target.value)} placeholder="e.g. A barista pouring latte art in a white cup, morning light" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category">
                <input list="media-categories" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Product" />
              </Field>
              <Field label="Subcategory">
                <input list="media-subcategories" value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)} placeholder={`e.g. ${subs[0] ?? "Close-up"}`} disabled={!form.category.trim()} />
              </Field>
              <datalist id="media-categories">{categories.map((c) => <option key={c.name} value={c.name} />)}</datalist>
              <datalist id="media-subcategories">{subs.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <Field label="Keywords" hint="What someone would search to find it. Enter or comma adds one.">
              <KeywordInput value={form.tags} onChange={(v) => set("tags", v)} />
            </Field>
            <Field label="Suitable for">
              <div className="flex flex-wrap gap-1.5">
                {MEDIA_USES.map((u) => {
                  const on = form.uses.includes(u.code);
                  return (
                    <button
                      key={u.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("uses", on ? form.uses.filter((x) => x !== u.code) : [...form.uses, u.code])}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-text"}`}
                    >
                      {u.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Notes for whoever uses it" hint="When not to use it: dated offer, text baked in, needs cropping, only for one brand…">
              <textarea rows={2} value={form.usageNotes} onChange={(e) => set("usageNotes", e.target.value)} />
            </Field>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {error && <p className="mr-auto text-xs text-danger">{error}</p>}
          {!error && note && <p className="mr-auto text-xs text-ok">{note}</p>}
          {!error && !note && <span className="mr-auto" />}
          {editable && m.kind === "image" && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={askClaude} title="Claude looks at the image and fills every field">
              {busy === "claude" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Fill with Claude
            </Button>
          )}
          {editable && (
            <>
              <Button size="sm" disabled={!!busy} onClick={() => save()}>
                {busy === "save" && <Loader2 className="size-4 animate-spin" />} Save
              </Button>
              {index < items.length - 1 && (
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => save("next")}>Save &amp; next</Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
