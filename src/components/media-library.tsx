"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Layers, Loader2, RotateCcw, Search, Sparkles, Tag, Trash2, Upload } from "lucide-react";
import { Card, CardHeader, buttonClass } from "./ui";
import {
  uploadMediaAction, uploadMasterMediaAction, uploadBrandVersionAction, clearBrandVersionAction, deleteMediaAction, catalogueMediaAction,
} from "@/server/actions/media";
import type { ActionResult } from "@/lib/action-result";
import { withDims } from "@/lib/media-dims";
import { SourceImportButtons, type SourceStatus } from "./media-sources";
import { MediaCatalogEditor } from "./media-catalog-editor";
import { MEDIA_USES, categoriesIn, searchMedia, labelForUse, type MediaQuery, type Orientation } from "@/lib/media-catalog";

export type MediaRow = {
  id: string; url: string; kind: string; originalName: string; size: number; createdAt: string;
  source: string | null; sourceUrl: string | null;
  /** A master asset shown in a brand's library. */
  isMaster?: boolean;
  /** A brand file that stands in for a master asset: that asset's name. */
  versionOf?: string | null;
  /** In the master library: the brands that have their own version. */
  versions?: { brandName: string; brandColor: string }[];
  /** Whether this person may delete it. */
  canDelete?: boolean;
  /** The catalogue: how it is filed and where it suits. */
  width?: number | null; height?: number | null;
  altText?: string | null; tags?: string[];
  category?: string | null; subcategory?: string | null;
  uses?: string[]; usageNotes?: string | null;
  catalogedAt?: string | null; catalogedBy?: string | null;
  /** Whether this person may file it. */
  canCatalog?: boolean;
};

type Status = "" | "unfiled" | "claude";

/** Chunks sent to Claude per call; the action files at most this many. */
const BATCH = 6;

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/**
 * One library card. With a brand it is that brand's files plus every master
 * asset it has not replaced; without one it is the master library itself.
 */
export function MediaLibrary({
  brandId, brandName, items, canEdit, sources = [],
}: {
  /** null = the master library. */
  brandId: string | null;
  brandName: string;
  items: MediaRow[];
  canEdit: boolean;
  sources?: SourceStatus[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<MediaQuery & { status?: Status }>({});
  // The files on screen when the editor opened, so filing one does not shift the rest.
  const [editing, setEditing] = useState<{ ids: string[]; index: number } | null>(null);
  const [filing, setFiling] = useState<{ done: number; total: number } | null>(null);

  const categories = useMemo(() => categoriesIn(items), [items]);
  const inUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of items) if (m.category) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return counts;
  }, [items]);
  const shown = useMemo(() => {
    const found = searchMedia(items, { ...filter, uncatalogued: filter.status === "unfiled" });
    return filter.status === "claude" ? found.filter((m) => m.catalogedBy === "claude") : found;
  }, [items, filter]);
  const unfiled = items.filter((m) => !m.catalogedAt && m.kind === "image" && m.canCatalog !== false);
  const filtering = Object.values(filter).some(Boolean);
  const setF = (patch: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...patch }));

  /** Files every unfiled image with Claude, a batch at a time, and reports what it could not. */
  async function fileAll() {
    const ids = unfiled.map((m) => m.id);
    if (!ids.length) return;
    setError(null);
    setFiling({ done: 0, total: ids.length });
    const failed: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const res = await catalogueMediaAction(ids.slice(i, i + BATCH));
        if (!res.ok) { failed.push(res.error); break; }
        failed.push(...res.failed.map((f) => f.error));
        setFiling({ done: Math.min(i + BATCH, ids.length), total: ids.length });
        router.refresh();
      }
    } catch (e) {
      failed.push(e instanceof Error ? e.message : "Filing stopped.");
    } finally {
      setFiling(null);
      if (failed.length) setError(`Claude could not file ${failed.length}: ${[...new Set(failed)].slice(0, 3).join(" ")}`);
      router.refresh();
    }
  }

  async function run(work: () => Promise<ActionResult>) {
    setUploading(true);
    setError(null);
    try {
      const res = await work();
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setUploading(false); }
  }

  /** Deletes and resets: no upload spinner, just the transition. */
  function act(work: () => Promise<ActionResult>) {
    setError(null);
    start(async () => {
      const res = await work();
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }

  // Each file goes with its pixel size, so the playbook can check sizes and ratios.
  const filesToForm = (files: FileList) => withDims(Array.from(files));

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = files;
    void run(async () => {
      const fd = await filesToForm(list);
      return brandId ? uploadMediaAction(brandId, fd) : uploadMasterMediaAction(fd);
    });
  }

  function uploadVersion(files: FileList | null) {
    const masterId = versionFor;
    if (!files?.length || !masterId || !brandId) return;
    const list = files;
    void run(async () => uploadBrandVersionAction(brandId, masterId, await filesToForm(list)));
    if (versionInput.current) versionInput.current.value = "";
  }

  const own = items.filter((m) => !m.isMaster).length;
  const shared = items.length - own;

  return (
    <Card>
      <CardHeader
        icon={brandId ? undefined : Layers}
        title={brandName}
        subtitle={brandId
          ? `${own} file${own === 1 ? "" : "s"}${shared ? ` · ${shared} from the master library` : ""}`
          : `${items.length} master asset${items.length === 1 ? "" : "s"} · every brand can use these, and swap in its own version`}
        action={
          canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {unfiled.length > 0 && (
                <button
                  type="button"
                  disabled={!!filing}
                  onClick={fileAll}
                  className={buttonClass("ghost", "sm")}
                  title="Claude looks at each image and fills in what it shows, its category, keywords and where it suits. Check them after."
                >
                  {filing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {filing ? `Filing ${filing.done}/${filing.total}…` : `File ${unfiled.length} with Claude`}
                </button>
              )}
              {brandId && <SourceImportButtons brandId={brandId} sources={sources} onError={setError} />}
              <label className={`${buttonClass("subtle", "sm")} cursor-pointer`}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {brandId ? "Upload" : "Upload to master"}
                <input type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
              </label>
            </div>
          ) : null
        }
      />
      {error && <p className="mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      <input ref={versionInput} type="file" hidden onChange={(e) => uploadVersion(e.target.files)} />

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <label className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={filter.q ?? ""}
              onChange={(e) => setF({ q: e.target.value })}
              placeholder="Search keywords, descriptions, names…"
              className="w-full pl-7"
              aria-label={`Search ${brandName}`}
            />
          </label>
          <select className="w-auto max-w-full" value={filter.category ?? ""} onChange={(e) => setF({ category: e.target.value || undefined, subcategory: undefined })} aria-label="Category">
            <option value="">All categories</option>
            {categories.filter((c) => inUse.has(c.name)).map((c) => <option key={c.name} value={c.name}>{c.name} ({inUse.get(c.name)})</option>)}
          </select>
          {filter.category && (
            <select className="w-auto max-w-full" value={filter.subcategory ?? ""} onChange={(e) => setF({ subcategory: e.target.value || undefined })} aria-label="Subcategory">
              <option value="">All in {filter.category}</option>
              {[...new Set(items.filter((m) => m.category?.toLowerCase() === filter.category!.toLowerCase() && m.subcategory).map((m) => m.subcategory!))]
                .map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select className="w-auto max-w-full" value={filter.use ?? ""} onChange={(e) => setF({ use: e.target.value || undefined })} aria-label="Suitable for">
            <option value="">Any use</option>
            {MEDIA_USES.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
          </select>
          <select className="w-auto max-w-full" value={filter.orientation ?? ""} onChange={(e) => setF({ orientation: (e.target.value || undefined) as Orientation | undefined })} aria-label="Shape">
            <option value="">Any shape</option>
            <option value="square">Square</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
          <select className="w-auto max-w-full" value={filter.status ?? ""} onChange={(e) => setF({ status: e.target.value as Status })} aria-label="Filed">
            <option value="">Filed or not</option>
            <option value="unfiled">Not filed yet</option>
            <option value="claude">Filed by Claude</option>
          </select>
          {filtering && (
            <button type="button" onClick={() => setFilter({})} className="text-xs text-muted hover:text-text">
              Clear · {shown.length} of {items.length}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((m, i) => (
          <div key={m.id} className={`group overflow-hidden rounded-lg border ${m.isMaster ? "border-dashed border-border" : "border-border"}`}>
            <div className="relative aspect-square bg-surface-2">
              <button
                type="button"
                onClick={() => setEditing({ ids: shown.map((x) => x.id), index: i })}
                className="absolute inset-0 z-0"
                aria-label={`File ${m.originalName}`}
                title={m.altText ?? "Open to file it: category, keywords, where it suits"}
              />
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.altText ?? ""} className="pointer-events-none size-full object-cover" />
              ) : m.kind === "video" ? (
                <video src={m.url} className="pointer-events-none size-full object-cover" muted />
              ) : (
                <span className="pointer-events-none grid size-full place-items-center text-xs text-muted">{m.originalName.split(".").pop()}</span>
              )}
              {!m.catalogedAt && (
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">Not filed</span>
              )}
              {(m.isMaster || m.versionOf) && (
                <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {m.isMaster ? "Master" : "Brand version"}
                </span>
              )}
              {canEdit && m.canDelete !== false && !m.isMaster && (
                <button
                  disabled={pending}
                  onClick={() => { if (confirm(`Delete ${m.originalName}? Posts using it lose it.`)) act(() => deleteMediaAction(m.id)); }}
                  className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-1 px-2 py-1.5">
              <p className="truncate text-[11px]" title={m.originalName}>{m.originalName}</p>
              {m.category && (
                <p className="flex min-w-0 items-center gap-1 text-[10px]" title={[m.category, m.subcategory].filter(Boolean).join(" › ")}>
                  <Tag className="size-3 shrink-0 text-muted" />
                  <button type="button" onClick={() => setF({ category: m.category!, subcategory: undefined })} className="truncate font-medium hover:underline">
                    {m.category}{m.subcategory ? ` › ${m.subcategory}` : ""}
                  </button>
                  {m.catalogedBy === "claude" && <Sparkles className="size-3 shrink-0 text-muted" aria-label="Filed by Claude" />}
                </p>
              )}
              {(m.uses?.length ?? 0) > 0 && (
                <p className="truncate text-[10px] text-muted" title={m.uses!.map(labelForUse).join(", ")}>{m.uses!.map(labelForUse).join(" · ")}</p>
              )}
              <p className="flex items-center gap-1 text-[10px] text-muted">
                {human(m.size)}
                {m.source && <span>· {m.source === "canva" ? "Canva" : "Google Photos"}</span>}
                {m.sourceUrl && (
                  <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto hover:text-text" title="Edit in Canva">
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </p>
              {m.versionOf && (
                <p className="flex items-center gap-1 text-[10px] text-muted">
                  <span className="min-w-0 flex-1 truncate" title={`Stands in for the master asset ${m.versionOf}`}>For {m.versionOf}</span>
                  {canEdit && (
                    <button
                      disabled={pending}
                      onClick={() => act(() => clearBrandVersionAction(m.id))}
                      className="shrink-0 hover:text-text"
                      title="Use the master asset again in this brand"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  )}
                </p>
              )}
              {m.isMaster && brandId && canEdit && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => { setVersionFor(m.id); versionInput.current?.click(); }}
                  className="text-[10px] text-accent hover:underline"
                  title={`Upload ${brandName}'s own version — it replaces the master in this brand's posts`}
                >
                  Upload {brandName} version
                </button>
              )}
              {m.versions && m.versions.length > 0 && (
                <p className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
                  <span>Versions:</span>
                  {m.versions.map((v) => (
                    <span key={v.brandName} className="size-2 rounded-full" style={{ background: v.brandColor }} title={v.brandName} />
                  ))}
                </p>
              )}
            </div>
          </div>
        ))}
        {items.length > 0 && shown.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted">Nothing matches. Try fewer words, or clear the filters.</p>
        )}
        {items.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted">
            {brandId ? "Nothing here yet." : "No master assets yet. Upload files every brand should be able to use."}
          </p>
        )}
      </div>
      {editing && (() => {
        const list = editing.ids.flatMap((id) => items.find((x) => x.id === id) ?? []);
        const index = Math.min(editing.index, list.length - 1);
        return list.length > 0 && (
        <MediaCatalogEditor
          key={list[index].id}
          items={list}
          index={index}
          categories={categories}
          onIndex={(n) => setEditing({ ...editing, index: n })}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
        );
      })()}
    </Card>
  );
}
