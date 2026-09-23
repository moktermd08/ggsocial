import "server-only";

/** Canva Connect API — https://www.canva.dev/docs/connect/ */
const API = "https://api.canva.com/rest/v1";

export type CanvaDesign = {
  id: string;
  title: string;
  thumbnail: string | null;
  editUrl: string | null;
  pageCount: number | null;
  updatedAt: string | null;
};

export const CANVA_FORMATS = ["png", "jpg", "pdf"] as const;
export type CanvaFormat = (typeof CANVA_FORMATS)[number];

const MIME: Record<CanvaFormat, string> = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" };

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Canva: ${json.message ?? json.code ?? res.status}`);
  return json as T;
}

export async function getProfileName(token: string) {
  try {
    const json = await call<{ profile?: { display_name?: string } }>(token, "/users/me/profile");
    return json.profile?.display_name ?? null;
  } catch {
    return null;
  }
}

type RawDesign = {
  id: string;
  title?: string;
  thumbnail?: { url: string };
  urls?: { edit_url?: string };
  page_count?: number;
  updated_at?: number;
};

export async function listDesigns(token: string, opts: { query?: string; continuation?: string }) {
  const params = new URLSearchParams({ ownership: "any", sort_by: "modified_descending" });
  if (opts.query) params.set("query", opts.query);
  if (opts.continuation) params.set("continuation", opts.continuation);
  const json = await call<{ items: RawDesign[]; continuation?: string }>(token, `/designs?${params}`);
  return {
    continuation: json.continuation ?? null,
    designs: json.items.map(toDesign),
  };
}

function toDesign(d: RawDesign): CanvaDesign {
  return {
    id: d.id,
    title: d.title || "Untitled design",
    thumbnail: d.thumbnail?.url ?? null,
    editUrl: d.urls?.edit_url ?? null,
    pageCount: d.page_count ?? null,
    updatedAt: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : null,
  };
}

/* ---------------------------------------------------------------- folders */

export type CanvaFolder = { id: string; name: string };

/**
 * Takes a folder link (canva.com/folder/FAHWCXWEHw4) or a bare ID and returns
 * the ID, or null when it doesn't look like either.
 */
export function parseFolderId(input: string) {
  const s = input.trim();
  const m = s.match(/canva\.com\/folder\/([A-Za-z0-9_-]+)/) ?? s.match(/^([A-Za-z0-9_-]{6,})$/);
  return m?.[1] ?? null;
}

export async function getFolder(token: string, folderId: string): Promise<CanvaFolder> {
  const json = await call<{ folder: { id: string; name?: string } }>(token, `/folders/${encodeURIComponent(folderId)}`);
  return { id: json.folder.id, name: json.folder.name || "Untitled folder" };
}

type RawFolderItem =
  | { type: "folder"; folder: { id: string; name?: string } }
  | { type: "design"; design: RawDesign }
  | { type: "image" | "brand_template" };

/** One page of a folder: its subfolders and designs. Uploaded images are skipped; they can't be exported. */
export async function listFolderItems(token: string, folderId: string, continuation?: string) {
  const params = new URLSearchParams({ sort_by: "modified_descending" });
  if (continuation) params.set("continuation", continuation);
  const json = await call<{ items: RawFolderItem[]; continuation?: string }>(
    token, `/folders/${encodeURIComponent(folderId)}/items?${params}`,
  );
  const folders: CanvaFolder[] = [];
  const designs: CanvaDesign[] = [];
  for (const item of json.items) {
    if (item.type === "folder") folders.push({ id: item.folder.id, name: item.folder.name || "Untitled folder" });
    else if (item.type === "design") designs.push(toDesign(item.design));
  }
  return { continuation: json.continuation ?? null, folders, designs };
}

export async function getDesign(token: string, designId: string) {
  const json = await call<{ design: RawDesign }>(token, `/designs/${encodeURIComponent(designId)}`);
  return { title: json.design.title || "Untitled design", editUrl: json.design.urls?.edit_url ?? null };
}

type ExportJob = { id: string; status: "in_progress" | "success" | "failed"; urls?: string[]; error?: { message?: string } };

/**
 * Renders a design and returns one downloaded file per page (PDF is always a
 * single file). Canva exports are async jobs; this polls until done.
 */
export async function exportDesign(token: string, designId: string, format: CanvaFormat) {
  let { job } = await call<{ job: ExportJob }>(token, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format: { type: format } }),
  });

  const deadline = Date.now() + 90_000;
  while (job.status === "in_progress") {
    if (Date.now() > deadline) throw new Error("Canva is still rendering this design. Try again in a minute.");
    await new Promise((r) => setTimeout(r, 1500));
    ({ job } = await call<{ job: ExportJob }>(token, `/exports/${job.id}`));
  }
  if (job.status !== "success" || !job.urls?.length) {
    throw new Error(`Canva export failed: ${job.error?.message ?? "unknown error"}`);
  }

  // Export URLs are short-lived, so pull the bytes now rather than storing links.
  return Promise.all(job.urls.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download the Canva export (${res.status}).`);
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: MIME[format] };
  }));
}
