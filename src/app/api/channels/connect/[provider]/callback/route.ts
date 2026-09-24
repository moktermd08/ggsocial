import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, channels } from "@/lib/db";
import { getPlatform } from "@/lib/platforms";
import {
  CHANNEL_PENDING_COOKIE, CHANNEL_PROVIDERS, accountsFromCode, channelRedirectUri, connectChannel, holdCandidates,
  isChannelProvider, pickObvious, readChannelPending,
} from "@/server/channel-auth";

/**
 * Where Facebook or Google sends the person back. One matching account
 * connects straight away; several send them to pick which one this channel is.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isChannelProvider(provider)) return new NextResponse("Unknown provider", { status: 404 });

  // APP_URL, not req.nextUrl: behind Apache that is the internal 127.0.0.1:3200 address.
  const back = new URL("/channels", new URL(channelRedirectUri(provider)).origin);
  const finish = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: CHANNEL_PENDING_COOKIE, path: "/api/channels/connect" });
    return res;
  };
  const name = CHANNEL_PROVIDERS[provider].name;

  const q = req.nextUrl.searchParams;
  const pending = readChannelPending(req.cookies.get(CHANNEL_PENDING_COOKIE)?.value);
  if (q.get("error")) return finish({ connectError: `${name} sign-in was cancelled.` });
  if (!pending || pending.provider !== provider || pending.state !== q.get("state")) {
    return finish({ connectError: `${name} sign-in expired or came from somewhere else. Try again.` });
  }
  const code = q.get("code");
  if (!code) return finish({ connectError: `${name} did not return an authorization code.` });

  const channel = await db.query.channels.findFirst({ where: eq(channels.id, pending.channelId) });
  if (!channel) return finish({ connectError: "That channel no longer exists." });
  const platformName = getPlatform(channel.platform).name;

  try {
    const candidates = await accountsFromCode(provider, channel.platform, code, pending.verifier);
    if (candidates.length === 0) {
      return finish({ connectError: `That ${name} sign-in has no ${platformName} account ggsocial can manage.${channel.platform === "instagram" ? " The Instagram account must be a business or creator account linked to a Facebook Page you manage." : ""}` });
    }
    const obvious = pickObvious(candidates, channel);
    if (obvious) {
      await connectChannel(channel.id, obvious, pending.userId);
      return finish({ connected: channel.id });
    }
    return finish({ pick: await holdCandidates(channel.id, pending.userId, candidates) });
  } catch (e) {
    return finish({ connectError: `Could not connect ${platformName}: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export const dynamic = "force-dynamic";
