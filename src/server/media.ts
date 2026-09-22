import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { MediaItem } from "@/lib/platforms";

const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

export type StoredFile = { url: string; size: number; kind: MediaItem["kind"] };

export function kindFromMime(mime: string): MediaItem["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/**
 * Writes an upload to the configured store and returns a path the app serves.
 * Local disk is the default; set MEDIA_DRIVER=s3 with the S3_* vars to use
 * object storage (required on serverless hosts, whose filesystems are ephemeral).
 */
export async function storeUpload(file: File): Promise<StoredFile> {
  return storeBuffer(Buffer.from(await file.arrayBuffer()), file.name, file.type);
}

/** Same as storeUpload, for bytes fetched from somewhere else (Canva, Google Photos). */
export async function storeBuffer(buffer: Buffer, name: string, mimeType: string): Promise<StoredFile> {
  const ext = path.extname(name) || "";
  const key = `${nanoid(20)}${ext}`;
  const kind = kindFromMime(mimeType);

  if (process.env.MEDIA_DRIVER === "s3") {
    const { S3_BUCKET, S3_REGION, S3_PUBLIC_BASE } = process.env;
    if (!S3_BUCKET || !S3_REGION) throw new Error("MEDIA_DRIVER=s3 requires S3_BUCKET and S3_REGION");
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({ region: S3_REGION });
    await client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
    return { url: `${S3_PUBLIC_BASE ?? `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`}/${key}`, size: buffer.length, kind };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, key), buffer);
  return { url: `/api/media/file/${key}`, size: buffer.length, kind };
}

export async function readLocalUpload(key: string) {
  const safe = path.basename(key);
  return fs.readFile(path.join(UPLOAD_DIR, safe));
}

/** Absolute URL for platform APIs that fetch media themselves. */
export function publicUrl(url: string) {
  if (url.startsWith("http")) return url;
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${url}`;
}
