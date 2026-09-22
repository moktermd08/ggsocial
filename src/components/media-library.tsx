"use client";
import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Trash2, Upload } from "lucide-react";
import { Card, CardHeader, buttonClass } from "./ui";
import { uploadMediaAction, deleteMediaAction } from "@/server/actions/media";
import { SourceImportButtons, type SourceStatus } from "./media-sources";

export type MediaRow = {
  id: string; url: string; kind: string; originalName: string; size: number; createdAt: string;
  source: string | null; sourceUrl: string | null;
};

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function MediaLibrary({
  brandId, brandName, items, canEdit, sources = [],
}: { brandId: string; brandName: string; items: MediaRow[]; canEdit: boolean; sources?: SourceStatus[] }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      await uploadMediaAction(brandId, fd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={brandName}
        subtitle={`${items.length} file${items.length === 1 ? "" : "s"}`}
        action={
          canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SourceImportButtons brandId={brandId} sources={sources} onError={setError} />
              <label className={`${buttonClass("subtle", "sm")} cursor-pointer`}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload
                <input type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
              </label>
            </div>
          ) : null
        }
      />
      {error && <p className="mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((m) => (
          <div key={m.id} className="group overflow-hidden rounded-lg border border-border">
            <div className="relative aspect-square bg-surface-2">
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="size-full object-cover" />
              ) : m.kind === "video" ? (
                <video src={m.url} className="size-full object-cover" muted />
              ) : (
                <span className="grid size-full place-items-center text-xs text-muted">{m.originalName.split(".").pop()}</span>
              )}
              {canEdit && (
                <button
                  disabled={pending}
                  onClick={() => { if (confirm(`Delete ${m.originalName}?`)) start(() => { void deleteMediaAction(m.id); }); }}
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <div className="px-2 py-1.5">
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
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted">Nothing here yet.</p>}
      </div>
    </Card>
  );
}
