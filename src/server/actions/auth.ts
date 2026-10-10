"use server";
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, users, memberships, invites } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { findOpenInvite } from "@/lib/auth/invite";
import { createSession, destroySession } from "@/lib/auth/session";

export type FormState = { error?: string; ok?: boolean };

const credentials = z.object({
  email: z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  // Blank is fine: an empty name falls back to the email local part below.
  name: z.string().optional(),
  invite: z.string().optional(),
});

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const inviteRaw = formData.get("invite");
  const parsed = credentials.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    name: String(formData.get("name") ?? ""),
    invite: inviteRaw ? String(inviteRaw) : undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password, name, invite } = parsed.data;

  // Invitation only: there is no open sign-up. The link's invite must be unused
  // and sent to the address being registered.
  const tokenRow = await findOpenInvite(invite);
  if (!tokenRow) return { error: "Sign-up is by invitation only. Ask an admin for an invite link." };
  if (tokenRow.email.toLowerCase() !== email.toLowerCase().trim()) {
    return { error: "This invite was sent to a different email address." };
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (existing) return { error: "That email already has an account. Sign in instead." };

  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    name: name?.trim() || email.split("@")[0],
    passwordHash: await hashPassword(password),
  }).returning();

  // The link's own invite, plus any other open invites sent to this address
  // (adding someone to several brands at once creates one invite per brand).
  const sameEmail = await db.query.invites.findMany({
    where: and(eq(invites.email, user.email), isNull(invites.acceptedAt)),
  });
  const open = new Map<string, typeof sameEmail[number]>([[tokenRow.token, tokenRow]]);
  for (const row of sameEmail) open.set(row.token, row);
  for (const row of open.values()) {
    await db.insert(memberships).values({ userId: user.id, brandId: row.brandId, role: row.role }).onConflictDoNothing();
    await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.token, row.token));
  }

  await createSession(user.id);
  redirect("/");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Wrong email or password." };
  }
  await createSession(user.id);
  redirect("/");
}

export async function signOutAction() {
  await destroySession();
  redirect("/login");
}
