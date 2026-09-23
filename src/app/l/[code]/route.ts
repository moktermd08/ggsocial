import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, links, linkClicks, brands } from "@/lib/db";
import { withUtm, visitorHash, deviceFrom, isBotAgent, shortUrl } from "@/lib/links";
import { destinationMeta, previewHtml } from "@/server/link-preview";
import { publicUrl } from "@/server/media";

/** Every hit is a fresh lookup — a cached redirect would count nothing. */
export const dynamic = "force-dynamic";

/**
 * The redirect. This is the hottest path in the app and the only one a
 * stranger hits, so it does the minimum: one lookup, one write, one 302.
 *
 * A failure here must never cost a visit. If the click cannot be recorded the
 * person still gets where they were going — losing a row is an inconvenience,
 * losing the reader is the whole point of the link.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const link = await db.query.links.findFirst({ where: eq(links.code, code) });
  if (!link || link.archivedAt) {
    // Not a redirect to "/": behind the proxy req.url is the internal address,
    // and the app root is a password prompt to anyone following a link.
    return new NextResponse("This link has expired or does not exist.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const destination = withUtm(link.destination, {
    source: link.utmSource,
    medium: link.utmMedium,
    campaign: link.utmCampaign,
    content: link.utmContent,
  });

  const userAgent = req.headers.get("user-agent");
  const bot = isBotAgent(userAgent);

  try {
    // Proxies append to x-forwarded-for, so the client is the first entry.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const hash = visitorHash(ip, userAgent);

    await db.insert(linkClicks).values({
      linkId: link.id,
      referrer: req.headers.get("referer")?.slice(0, 500) ?? null,
      country: req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry") ?? null,
      device: deviceFrom(userAgent),
      visitorHash: hash,
      isBot: bot,
    });

    if (!bot) {
      // "Unique" is counted against the rows rather than kept as a running
      // tally, because the same person clicking twice must not add two.
      const [{ uniques }] = await db
        .select({ uniques: sql<number>`count(distinct ${linkClicks.visitorHash})::int` })
        .from(linkClicks)
        .where(sql`${linkClicks.linkId} = ${link.id} and ${linkClicks.isBot} = false`);

      await db.update(links).set({
        clickCount: sql`${links.clickCount} + 1`,
        uniqueCount: uniques,
        lastClickAt: new Date(),
      }).where(eq(links.id, link.id));
    }
  } catch (err) {
    console.error("Could not record click for", code, err);
  }

  if (bot) {
    const preview = await brandPreview(link.brandId, code, destination, link.label);
    if (preview) {
      return new NextResponse(preview, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }

  return NextResponse.redirect(destination, { status: 302 });
}

/**
 * The card a platform builds when this link is pasted. The destination's own
 * preview wins whenever it has an image; the brand's social image fills in
 * only where the card would otherwise be bare. null = just redirect, which is
 * also the answer to anything that goes wrong here.
 */
async function brandPreview(brandId: string, code: string, destination: string, label: string) {
  try {
    const brand = await db.query.brands.findFirst({
      where: eq(brands.id, brandId),
      columns: { name: true, tagline: true, socialImageUrl: true },
    });
    if (!brand?.socialImageUrl) return null;
    const meta = await destinationMeta(destination);
    // Unreadable to us is not the same as imageless: the platform may do better, so let it try.
    if (!meta || meta.image) return null;
    return previewHtml({
      shortUrl: shortUrl(code),
      destination,
      siteName: brand.name,
      title: meta.title ?? (label || brand.name),
      description: meta.description ?? brand.tagline,
      image: publicUrl(brand.socialImageUrl),
    });
  } catch (err) {
    console.error("Could not build link preview for", code, err);
    return null;
  }
}
