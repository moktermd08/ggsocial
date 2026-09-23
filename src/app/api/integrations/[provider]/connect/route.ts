import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { beginAuthorization, isProvider, PENDING_COOKIE, redirectUri } from "@/server/integrations/oauth";

/** Starts the OAuth dance for a media source and sends the user to the provider. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse("Unknown integration", { status: 404 });

  // The callback lands on APP_URL's host; cookies set on another host (localhost
  // vs 127.0.0.1) would never reach it, so start from that host too.
  // Behind Apache, nextUrl is the internal 127.0.0.1:3200 address, so compare
  // the host the browser actually asked for.
  const home = new URL(redirectUri(provider)).origin;
  const asked = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (asked !== new URL(home).host) return NextResponse.redirect(`${home}${req.nextUrl.pathname}`);

  const user = await requireUser();
  let auth;
  try {
    auth = beginAuthorization(provider, user.id);
  } catch (e) {
    const url = new URL("/library", home);
    url.searchParams.set("integrationError", e instanceof Error ? e.message : "Could not start sign-in.");
    return NextResponse.redirect(url);
  }

  const res = NextResponse.redirect(auth.url);
  res.cookies.set(PENDING_COOKIE, auth.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations",
    maxAge: 600,
  });
  return res;
}

export const dynamic = "force-dynamic";
