import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, isProvider, PENDING_COOKIE, PROVIDERS, readPending, saveIntegration } from "@/server/integrations/oauth";
import { getProfileName } from "@/server/integrations/canva";
import { getAccountEmail } from "@/server/integrations/google-photos";

/** Where the provider sends the user back. Stores the tokens against the user who started it. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse("Unknown integration", { status: 404 });

  const back = new URL("/library", req.nextUrl.origin);
  const fail = (message: string) => {
    back.searchParams.set("integrationError", message);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: PENDING_COOKIE, path: "/api/integrations" });
    return res;
  };

  const q = req.nextUrl.searchParams;
  const pending = readPending(req.cookies.get(PENDING_COOKIE)?.value);
  const name = PROVIDERS[provider].name;

  if (q.get("error")) return fail(`${name} sign-in was cancelled.`);
  if (!pending || pending.provider !== provider || pending.state !== q.get("state")) {
    return fail(`${name} sign-in expired or came from somewhere else. Try again.`);
  }
  const code = q.get("code");
  if (!code) return fail(`${name} did not return an authorization code.`);

  try {
    const tokens = await exchangeCode(provider, code, pending.verifier);
    const accountName = provider === "canva"
      ? await getProfileName(tokens.accessToken)
      : await getAccountEmail(tokens.accessToken);
    await saveIntegration(pending.userId, provider, tokens, accountName);
  } catch (e) {
    return fail(e instanceof Error ? e.message : `Could not connect ${name}.`);
  }

  back.searchParams.set("connected", provider);
  const res = NextResponse.redirect(back);
  res.cookies.delete({ name: PENDING_COOKIE, path: "/api/integrations" });
  return res;
}

export const dynamic = "force-dynamic";
