import { can } from "@/lib/auth";
import { db, media, activity } from "@/lib/db";
import { kindFromMime, storeUpload } from "@/server/media";
import { aiGeneratedMark } from "@/server/ai-provenance";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const MAX_BYTES = 200 * 1024 * 1024;

function positive(v: FormDataEntryValue | null) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Put one file in a brand's media library, e.g. a video exported from Canva.
 * multipart/form-data, so it works with `curl -F`:
 *
 *   POST /api/agent/media/upload
 *   brand=acme  file=@short.mp4  [width=1080 height=1920 durationSeconds=42]
 *   [description="…" category="Video" keywords="a,b" uses="story,feed" notes="…"]
 *
 * Returns the file's `id` (use it as a `mediaIds` entry when creating a post) and
 * its `url`. Pixel size and length are not read from the file here: send them if
 * you know them, so the playbook check can see them.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const form = await req.formData().catch(() => null);
    if (!form) throw new AgentError("Send multipart/form-data with a `brand` and a `file`.");

    const brand = pickBrands(brands, String(form.get("brand") ?? ""));
    if (brand.length !== 1) throw new AgentError("Name exactly one brand.");
    const b = brand[0];
    if (!can.edit(b.role)) throw new AgentError(`The token's owner is a ${b.role} on ${b.slug} and cannot add media.`, 403);

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AgentError("Attach the file as the `file` field.");
    if (file.size > MAX_BYTES) throw new AgentError(`${file.name} is over the 200 MB limit.`);

    const list = (v: FormDataEntryValue | null) =>
      String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
    const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max) || null;

    const duration = positive(form.get("durationSeconds"));
    const stored = await storeUpload(file);
    const [row] = await db.insert(media).values({
      brandId: b.id,
      kind: kindFromMime(file.type),
      url: stored.url,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: stored.size,
      width: positive(form.get("width")),
      height: positive(form.get("height")),
      durationMs: duration ? Math.round(duration * 1000) : null,
      aiGenerated: await aiGeneratedMark(file),
      altText: text(form.get("description"), 1000),
      category: text(form.get("category"), 60),
      subcategory: text(form.get("subcategory"), 60),
      tags: list(form.get("keywords")),
      uses: list(form.get("uses")),
      usageNotes: text(form.get("notes"), 1000),
      uploadedBy: agent.userId,
    }).returning();

    await db.insert(activity).values({
      brandId: b.id, actorId: agent.userId, action: "media.agent_upload", entity: "media", entityId: row.id,
      meta: { agent: agent.name, name: file.name },
    });

    return { id: row.id, url: row.url, kind: row.kind, name: row.originalName, size: row.size, brand: b.slug };
  });
}

export const dynamic = "force-dynamic";
