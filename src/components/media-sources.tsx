"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronRight, ExternalLink, Folder, FolderOpen, Images, Loader2, Palette, Search, Star, Unplug, X } from "lucide-react";
import { Button, Card, buttonClass } from "./ui";
import type { CanvaDesign, CanvaFolder, CanvaFormat } from "@/server/integrations/canva";
import {
  disconnectIntegrationAction,
  getCanvaBrandFolderAction,
  importCanvaDesignAction,
  importGooglePhotosAction,
  listCanvaDesignsAction,
  listCanvaFolderAction,
  pollGooglePhotosPickerAction,
  setCanvaBrandFolderAction,
  startGooglePhotosPickerAction,
} from "@/server/actions/integrations";
import type { ActionResult } from "@/lib/action-result";

export type SourceStatus = {
  provider: "canva" | "google_photos";
  name: string;
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  /** Env vars to set when not configured. */
  envHint: string;
};

const ICONS = { canva: Palette, google_photos: Images };

function message(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** The result's data, or a throw on this side, where the message survives, for the catch blocks below. */
function unwrap<T extends object>(res: ActionResult<T>) {
  if (!res.ok) throw new Error(res.error);
  return res;
}

/** The strip at the top of Media: which outside libraries this person has linked. */
export function SourceConnections({ sources }: { sources: SourceStatus[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
      <p className="text-xs font-medium text-muted">Import from</p>
      {sources.map((s) => {
        const Icon = ICONS[s.provider];
        return (
          <div key={s.provider} className="flex items-center gap-2 text-sm">
            <Icon className="size-4 text-muted" />
            <span className="font-medium">{s.name}</span>
            {!s.configured ? (
              <span className="text-xs text-muted" title={`Set ${s.envHint} in the server environment`}>not set up on this server</span>
            ) : s.connected ? (
              <>
                <span className="text-xs text-muted">{s.accountName ?? "connected"}</span>
                <button
                  disabled={pending}
                  title={`Disconnect ${s.name}`}
                  onClick={() => { if (confirm(`Disconnect ${s.name}?`)) { setError(null); start(async () => { const res = await disconnectIntegrationAction(s.provider); if (!res.ok) setError(res.error); }); } }}
                  className="grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
                >
                  <Unplug className="size-3.5" />
                </button>
              </>
            ) : (
              // A plain link, not fetch: the route redirects off to the provider.
              <a href={`/api/integrations/${s.provider}/connect`} className={buttonClass("subtle", "sm")}>Connect</a>
            )}
          </div>
        );
      })}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </Card>
  );
}

/** Import buttons in a brand's library header. Only shows sources that are connected. */
export function SourceImportButtons({ brandId, sources, onError }: {
  brandId: string; sources: SourceStatus[]; onError: (message: string | null) => void;
}) {
  const [canvaOpen, setCanvaOpen] = useState(false);
  const connected = new Set(sources.filter((s) => s.configured && s.connected).map((s) => s.provider));
  return (
    <>
      {connected.has("canva") && (
        <Button size="sm" onClick={() => setCanvaOpen(true)}><Palette className="size-4" /> Canva</Button>
      )}
      {connected.has("google_photos") && <GooglePhotosButton brandId={brandId} onError={onError} />}
      {canvaOpen && <CanvaPicker brandId={brandId} onClose={() => setCanvaOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ canva */

function CanvaPicker({ brandId, onClose }: { brandId: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  /** The brand's folder: undefined while it loads, null when none is set. */
  const [brandFolder, setBrandFolder] = useState<CanvaFolder | null | undefined>(undefined);
  /** Breadcrumb trail. Empty means every design in the account. */
  const [path, setPath] = useState<CanvaFolder[]>([]);
  const [folders, setFolders] = useState<CanvaFolder[]>([]);
  const [designs, setDesigns] = useState<CanvaDesign[]>([]);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<CanvaFormat>("png");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Drops responses for a folder or search the person has already moved away from. */
  const request = useRef(0);

  const current = path.at(-1) ?? null;

  // Open in the brand's folder when it has one.
  useEffect(() => {
    void (async () => {
      const res = await getCanvaBrandFolderAction(brandId);
      if (!res.ok) { setError(res.error); setBrandFolder(null); return; }
      setBrandFolder(res.folder);
      if (res.folder) setPath([res.folder]);
    })();
  }, [brandId]);

  async function load(folderId: string | null, q: string, cont?: string) {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const page = folderId
        ? unwrap(await listCanvaFolderAction(folderId, cont))
        : { folders: [], ...unwrap(await listCanvaDesignsAction(q, cont)) };
      if (id !== request.current) return;
      setFolders((prev) => (cont ? [...prev, ...page.folders] : page.folders));
      setDesigns((prev) => (cont ? [...prev, ...page.designs] : page.designs));
      setContinuation(page.continuation);
    } catch (e) {
      if (id === request.current) setError(message(e));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  // Canva can't search inside a folder, so there the box filters what's loaded;
  // across the whole account it's a debounced Canva search.
  const searchKey = current ? "" : query;
  useEffect(() => {
    if (brandFolder === undefined) return;
    const t = setTimeout(() => { void load(current?.id ?? null, searchKey); }, searchKey ? 350 : 0);
    return () => clearTimeout(t);
  }, [brandFolder, current?.id, searchKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function importDesign(d: CanvaDesign) {
    setBusy(d.id);
    setError(null);
    try {
      unwrap(await importCanvaDesignAction(brandId, d.id, format));
      setDone((prev) => new Set(prev).add(d.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveFolder(input: string | null) {
    setSaving(true);
    setError(null);
    try {
      const { folder } = unwrap(await setCanvaBrandFolderAction(brandId, input));
      setBrandFolder(folder);
      setLinkInput(null);
      if (folder && folder.id !== current?.id) setPath([folder]);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  function open(folder: CanvaFolder) {
    setQuery("");
    setPath((prev) => [...prev, folder]);
  }

  const filter = current ? query.trim().toLowerCase() : "";
  const shownFolders = filter ? folders.filter((f) => f.name.toLowerCase().includes(filter)) : folders;
  const shownDesigns = filter ? designs.filter((d) => d.title.toLowerCase().includes(filter)) : designs;
  const empty = shownFolders.length === 0 && shownDesigns.length === 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-label="Import from Canva"
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="mr-auto flex items-center gap-1.5 text-sm font-semibold"><Palette className="size-4 text-muted" /> Import from Canva</h2>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={current ? "Filter this folder" : "Search designs"} className="w-48 pl-7" autoFocus />
          </label>
          <select value={format} onChange={(e) => setFormat(e.target.value as CanvaFormat)} aria-label="Export format" className="w-auto">
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
            <option value="pdf">PDF</option>
          </select>
          <button onClick={onClose} disabled={!!busy} className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 text-xs" aria-label="Canva folders">
          <button
            onClick={() => { setQuery(""); setPath([]); }}
            className={`rounded px-1.5 py-0.5 hover:bg-surface-2 ${current ? "text-muted" : "font-medium"}`}
          >
            All designs
          </button>
          {path.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-muted" />
              <button
                onClick={() => { setQuery(""); setPath(path.slice(0, i + 1)); }}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-2 ${i === path.length - 1 ? "font-medium" : "text-muted"}`}
              >
                {f.id === brandFolder?.id && <Star className="size-3 fill-current text-warn" aria-label="This brand's folder" />}
                {f.name}
              </button>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-2">
            {current && current.id !== brandFolder?.id && (
              <Button size="sm" disabled={saving} onClick={() => saveFolder(current.id)}>
                <Star className="size-3.5" /> Use this folder for this brand
              </Button>
            )}
            {!current && brandFolder === null && linkInput === null && (
              <Button size="sm" onClick={() => setLinkInput("")}><FolderOpen className="size-3.5" /> Set brand folder</Button>
            )}
            {brandFolder && current?.id === brandFolder.id && (
              <button disabled={saving} onClick={() => saveFolder(null)} className="text-muted underline hover:text-text">
                Stop opening here
              </button>
            )}
          </span>
        </nav>

        {linkInput !== null && (
          <form
            onSubmit={(e) => { e.preventDefault(); void saveFolder(linkInput); }}
            className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2"
          >
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Paste a Canva folder link, e.g. https://www.canva.com/folder/FAH…"
              className="min-w-0 flex-1 text-xs"
              autoFocus
            />
            <Button size="sm" variant="primary" type="submit" disabled={saving || !linkInput.trim()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" type="button" onClick={() => setLinkInput(null)}>Cancel</Button>
          </form>
        )}

        {error && <p className="mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

        <div className="overflow-y-auto p-4">
          {shownFolders.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {shownFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => open(f)}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-surface-2"
                >
                  <Folder className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 truncate" title={f.name}>{f.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shownDesigns.map((d) => (
              <div key={d.id} className="group overflow-hidden rounded-lg border border-border">
                <button
                  disabled={!!busy}
                  onClick={() => importDesign(d)}
                  className="relative block aspect-[4/3] w-full bg-surface-2 disabled:cursor-wait"
                  title={`Add "${d.title}" as ${format.toUpperCase()}`}
                >
                  {d.thumbnail && (
                    // Canva thumbnail URLs are signed and short-lived; next/image would cache them past expiry.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.thumbnail} alt="" className="size-full object-contain" />
                  )}
                  <span className={`absolute inset-0 grid place-items-center bg-black/50 text-xs font-medium text-white transition-opacity ${
                    busy === d.id || done.has(d.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}>
                    {busy === d.id ? <Loader2 className="size-5 animate-spin" />
                      : done.has(d.id) ? <span className="flex items-center gap-1"><Check className="size-4" /> Added</span>
                      : `Add as ${format.toUpperCase()}`}
                  </span>
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <p className="min-w-0 flex-1 truncate text-[11px]" title={d.title}>{d.title}</p>
                  {d.pageCount && d.pageCount > 1 && <span className="text-[10px] text-muted">{d.pageCount} pages</span>}
                  {d.editUrl && (
                    <a href={d.editUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-text" title="Open in Canva">
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!loading && empty && !error && (
            <p className="py-10 text-center text-sm text-muted">
              {query ? "No designs match." : current ? "This folder is empty." : "No designs in this Canva account yet."}
            </p>
          )}
          {loading && <p className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted" /></p>}
          {!loading && continuation && (
            <div className="mt-4 flex justify-center">
              <Button size="sm" onClick={() => load(current?.id ?? null, searchKey, continuation)}>Load more</Button>
            </div>
          )}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
          Multi-page designs come in as one file per page (PDF stays one file). Edit in Canva, then import again to pick up changes.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- google photos */

const POLL_MS = 3000;
const GIVE_UP_MS = 15 * 60 * 1000;

function GooglePhotosButton({ brandId, onError }: { brandId: string; onError: (message: string | null) => void }) {
  const [phase, setPhase] = useState<"idle" | "picking" | "importing">("idle");
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  async function run() {
    onError(null);
    cancelled.current = false;
    // Open the tab inside the click so popup blockers let it through, then point it at Google.
    const tab = window.open("about:blank", "_blank");
    setPhase("picking");
    try {
      const { sessionId, pickerUri } = unwrap(await startGooglePhotosPickerAction());
      if (tab) tab.location.href = pickerUri;
      else window.open(pickerUri, "_blank");

      const started = Date.now();
      while (!unwrap(await pollGooglePhotosPickerAction(sessionId)).ready) {
        if (cancelled.current) return;
        if (Date.now() - started > GIVE_UP_MS) throw new Error("Timed out waiting for a Google Photos selection.");
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      setPhase("importing");
      unwrap(await importGooglePhotosAction(brandId, sessionId));
    } catch (e) {
      tab?.close();
      onError(message(e));
    } finally {
      setPhase("idle");
    }
  }

  if (phase === "idle") {
    return <Button size="sm" onClick={run}><Images className="size-4" /> Google Photos</Button>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Loader2 className="size-3.5 animate-spin" />
      {phase === "picking" ? "Pick photos in the Google tab…" : "Importing…"}
      {phase === "picking" && (
        <button onClick={() => { cancelled.current = true; setPhase("idle"); }} className="underline hover:text-text">Cancel</button>
      )}
    </span>
  );
}
