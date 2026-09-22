"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Layers, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { Card, CardHeader, buttonClass } from "./ui";
import {
  uploadMediaAction, uploadMasterMediaAction, uploadBrandVersionAction, clearBrandVersionAction, deleteMediaAction,
} from "@/server/actions/media";
import { SourceImportButtons, type SourceStatus } from "./media-sources";

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
};

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

  async function run(work: () => Promise<unknown>) {
    setUploading(true);
    setError(null);
    try { await work(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setUploading(false); }
  }

  const filesToForm = (files: FileList) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    return fd;
  };

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = filesToForm(files);
    void run(() => (brandId ? uploadMediaAction(brandId, fd) : uploadMasterMediaAction(fd)));
  }

  function uploadVersion(files: FileList | null) {
    const masterId = versionFor;
    if (!files?.length || !masterId || !brandId) return;
    void run(() => uploadBrandVersionAction(brandId, masterId, filesToForm(files)));
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

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => (
          <div key={m.id} className={`group overflow-hidden rounded-lg border ${m.isMaster ? "border-dashed border-border" : "border-border"}`}>
            <div className="relative aspect-square bg-surface-2">
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="size-full object-cover" />
              ) : m.kind === "video" ? (
                <video src={m.url} className="size-full object-cover" muted />
              ) : (
                <span className="grid size-full place-items-center text-xs text-muted">{m.originalName.split(".").pop()}</span>
              )}
              {(m.isMaster || m.versionOf) && (
                <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {m.isMaster ? "Master" : "Brand version"}
                </span>
              )}
              {canEdit && m.canDelete !== false && !m.isMaster && (
                <button
                  disabled={pending}
                  onClick={() => { if (confirm(`Delete ${m.originalName}? Posts using it lose it.`)) start(async () => { await deleteMediaAction(m.id); router.refresh(); }); }}
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <div className="space-y-1 px-2 py-1.5">
              <p className="truncate text-[11px]" title={m.originalName}>{m.originalName}</p>
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
                      onClick={() => start(async () => { await clearBrandVersionAction(m.id); router.refresh(); })}
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
        {items.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-muted">
            {brandId ? "Nothing here yet." : "No master assets yet. Upload files every brand should be able to use."}
          </p>
        )}
      </div>
    </Card>
  );
}
