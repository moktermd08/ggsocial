import "server-only";
import { db, media } from "@/lib/db";
import { storeBuffer } from "@/server/media";
import { getAccessToken } from "@/server/integrations/oauth";
import * as canva from "@/server/integrations/canva";

/** Pixel size a Canva video export has for each quality, so the playbook can see the aspect ratio. */
function videoSize(quality: canva.CanvaVideoQuality) {
  const [orientation, p] = quality.split("_");
  const short = p === "4k" ? 2160 : Number.parseInt(p, 10);
  const long = Math.round((short * 16) / 9);
  return orientation === "vertical" ? { width: short, height: long } : { width: long, height: short };
}

/**
 * Renders a Canva design with the user's own Canva connection and files every
 * page in the brand's library. The caller has already checked the user may edit
 * the brand. Shared by the Media page and the agent API.
 */
export async function importCanvaDesign(opts: {
  userId: string;
  brandId: string;
  designId: string;
  format: canva.CanvaFormat;
  quality?: canva.CanvaVideoQuality;
}) {
  const { userId, brandId, designId, format } = opts;
  const quality = opts.quality ?? "vertical_1080p";
  if (!canva.CANVA_FORMATS.includes(format)) throw new Error("Unsupported format.");
  if (format === "mp4" && !canva.CANVA_VIDEO_QUALITIES.includes(quality)) throw new Error("Unsupported video quality.");
  const token = await getAccessToken(userId, "canva");

  const design = await canva.getDesign(token, designId);
  const files = await canva.exportDesign(token, designId, format, quality);
  const base = design.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "canva-design";
  const size = format === "mp4" ? videoSize(quality) : { width: null, height: null };

  const saved: { id: string; name: string; url: string; kind: string }[] = [];
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
      ...size,
      source: "canva",
      sourceUrl: design.editUrl,
      uploadedBy: userId,
    }).returning({ id: media.id });
    saved.push({ id: row.id, name, url: stored.url, kind: stored.kind });
  }
  return saved;
}
