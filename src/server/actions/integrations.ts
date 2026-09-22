"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, integrations, media, type IntegrationProvider } from "@/lib/db";
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
