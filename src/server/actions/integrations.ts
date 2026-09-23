"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { brands, db, integrations, media, type IntegrationProvider } from "@/lib/db";
import { requireBrandRole, requireUser } from "@/lib/auth";
import { storeBuffer } from "@/server/media";
import { getAccessToken } from "@/server/integrations/oauth";
import * as canva from "@/server/integrations/canva";
import * as photos from "@/server/integrations/google-photos";

export async function disconnectIntegrationAction(provider: IntegrationProvider) {
  return asResult(async () => {
    const user = await requireUser();
    await db.delete(integrations).where(and(eq(integrations.userId, user.id), eq(integrations.provider, provider)));
    revalidatePath("/library");
  });
}

/* ------------------------------------------------------------------ canva */

export async function listCanvaDesignsAction(query?: string, continuation?: string) {
  return asResult(async () => {
    const user = await requireUser();
    const token = await getAccessToken(user.id, "canva");
    return canva.listDesigns(token, { query: query?.trim() || undefined, continuation });
  });
}

/** Folder calls need the folder:read scope, which connections made before folder support don't have. */
async function inFolder<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Canva refused.";
    throw new Error(`${msg} If you connected Canva before folders were supported, disconnect it on this page and connect again.`);
  }
}

/** The brand's Canva folder, where the import opens. null when none is set. */
export async function getCanvaBrandFolderAction(brandId: string) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId);
    const [brand] = await db.select({ folderId: brands.canvaFolderId }).from(brands).where(eq(brands.id, brandId));
    if (!brand?.folderId) return { folder: null };
    const token = await getAccessToken(user.id, "canva");
    return { folder: await inFolder(() => canva.getFolder(token, brand.folderId!)) };
  });
}

export async function listCanvaFolderAction(folderId: string, continuation?: string) {
  return asResult(async () => {
    const user = await requireUser();
    const token = await getAccessToken(user.id, "canva");
    return inFolder(() => canva.listFolderItems(token, folderId, continuation));
  });
}

/** Points the brand at a Canva folder (a folder link or ID), or clears it with null. */
export async function setCanvaBrandFolderAction(brandId: string, input: string | null) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "editor");
    if (!input?.trim()) {
      await db.update(brands).set({ canvaFolderId: null }).where(eq(brands.id, brandId));
      return { folder: null };
    }
    const folderId = canva.parseFolderId(input);
    if (!folderId) throw new Error("Paste a Canva folder link, like https://www.canva.com/folder/FAH…");
    const token = await getAccessToken(user.id, "canva");
    // Checks the folder exists and this account can see it before saving.
    const folder = await inFolder(() => canva.getFolder(token, folderId));
    await db.update(brands).set({ canvaFolderId: folder.id }).where(eq(brands.id, brandId));
    return { folder };
  });
}

/** Renders a Canva design and adds every page to the brand's library. */
export async function importCanvaDesignAction(brandId: string, designId: string, format: canva.CanvaFormat) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "editor");
    if (!canva.CANVA_FORMATS.includes(format)) throw new Error("Unsupported format.");
    const token = await getAccessToken(user.id, "canva");

    const design = await canva.getDesign(token, designId);
    const files = await canva.exportDesign(token, designId, format);
    const base = design.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "canva-design";

    const saved: string[] = [];
    for (const [i, f] of files.entries()) {
      const name = files.length > 1 ? `${base} (${i + 1}).${format}` : `${base}.${format}`;
      const stored = await storeBuffer(f.buffer, name, f.mimeType);
      const [row] = await db.insert(media).values({
        brandId,
        kind: stored.kind,
        url: stored.url,
        originalName: name,
        mimeType: f.mimeType,
        size: stored.size,
        source: "canva",
        sourceUrl: design.editUrl,
        uploadedBy: user.id,
      }).returning({ id: media.id });
      saved.push(row.id);
    }
    revalidatePath("/", "layout");
    return { ids: saved };
  });
}

/* ---------------------------------------------------------- google photos */

export async function startGooglePhotosPickerAction() {
  return asResult(async () => {
    const user = await requireUser();
    const token = await getAccessToken(user.id, "google_photos");
    return photos.createSession(token);
  });
}

/** True once the user has pressed Done in Google's picker. */
export async function pollGooglePhotosPickerAction(sessionId: string) {
  return asResult(async () => {
    const user = await requireUser();
    const token = await getAccessToken(user.id, "google_photos");
    return { ready: await photos.isSessionReady(token, sessionId) };
  });
}

const MAX_BYTES = 200 * 1024 * 1024;

export async function importGooglePhotosAction(brandId: string, sessionId: string) {
  return asResult(async () => {
    const { user } = await requireBrandRole(brandId, "editor");
    const token = await getAccessToken(user.id, "google_photos");

    const items = await photos.listPicked(token, sessionId);
    const saved: string[] = [];
    try {
      for (const item of items) {
        const f = await photos.downloadItem(token, item);
        if (f.buffer.length > MAX_BYTES) throw new Error(`${f.filename} is over the 200 MB limit.`);
        const stored = await storeBuffer(f.buffer, f.filename, f.mimeType);
        const [row] = await db.insert(media).values({
          brandId,
          kind: stored.kind,
          url: stored.url,
          originalName: f.filename,
          mimeType: f.mimeType,
          size: stored.size,
          width: f.width,
          height: f.height,
          source: "google_photos",
          uploadedBy: user.id,
        }).returning({ id: media.id });
        saved.push(row.id);
      }
    } finally {
      // Sessions hold the user's selection on Google's side; drop it once we have the files.
      await photos.deleteSession(token, sessionId);
      revalidatePath("/", "layout");
    }
    return { ids: saved };
  });
}
