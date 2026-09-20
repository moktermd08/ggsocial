import { NextResponse } from "next/server";
import { like } from "drizzle-orm";
import { db, media } from "@/lib/db";
import { readLocalUpload } from "@/server/media";

/**
 * Serves locally stored uploads. Kept unauthenticated on purpose: Meta,
 * Pinterest and TikTok fetch media by URL with no credentials of ours.
 * The keys are unguessable (nanoid). Use S3 with signed URLs if you need more.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const row = await db.query.media.findFirst({ where: like(media.url, `%${key}`) });
  if (!row) return new NextResponse("Not found", { status: 404 });
  try {
    const buf = await readLocalUpload(key);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": row.mimeType, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

export const dynamic = "force-dynamic";