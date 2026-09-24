import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, channels } from "@/lib/db";
import { requireBrandRole } from "@/lib/auth";
import {
  CHANNEL_PENDING_COOKIE, beginChannelAuth, channelRedirectUri, isChannelProvider, providerFor,
} from "@/server/channel-auth";

/** Starts "Connect with Facebook / Google" for one channel. Brand admins only, as pasting a token was. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isChannelProvider(provider)) return new NextResponse("Unknown provider", { status: 404 });

  // The callback lands on APP_URL's host, so the cookie has to be set there too.
  // Behind Apache, nextUrl is the internal address: compare the host the browser asked for.
  const home = new URL(channelRedirectUri(provider)).origin;
  const asked = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (asked !== new URL(home).host) return NextResponse.redirect(`${home}${req.nextUrl.pathname}${req.nextUrl.search}`);

  const back = new URL("/channels", home);
  const fail = (message: string) => {
    back.searchParams.set("connectError", message);
    return NextResponse.redirect(back);
  };

  const channelId = req.nextUrl.searchParams.get("channelId") ?? "";
  const channel = await db.query.channels.findFirst({ where: eq(channels.id, channelId) });
  if (!channel) return fail("That channel no longer exists.");
  if (providerFor(channel.platform) !== provider) return fail("That channel does not sign in this way.");
  let user;
  try {
    ({ user } = await requireBrandRole(channel.brandId, "admin"));
  } catch {
    return fail("Only brand admins can connect channels.");
  }

  let auth;
  try {
    auth = beginChannelAuth(provider, channel.id, user.id);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not start the sign-in.");
  }
  const res = NextResponse.redirect(auth.url);
  res.cookies.set(CHANNEL_PENDING_COOKIE, auth.cookie, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/api/channels/connect", maxAge: 600,
  });
  return res;
}

export const dynamic = "force-dynamic";
