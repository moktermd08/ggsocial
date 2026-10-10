import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, invites } from "@/lib/db";

/** The unused invite behind a sign-up link, or null if the token is missing, wrong or already used. */
export async function findOpenInvite(token: string | undefined | null) {
  if (!token) return null;
  const row = await db.query.invites.findFirst({
    where: and(eq(invites.token, token), isNull(invites.acceptedAt)),
  });
  return row ?? null;
}
