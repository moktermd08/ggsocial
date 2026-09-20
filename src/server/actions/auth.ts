"use server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, users, memberships, invites } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
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

  const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (existing) return { error: "That email already has an account. Sign in instead." };

  const [user] = await db.insert(users).values({
    email: email.toLowerCase(),
    name: name?.trim() || email.split("@")[0],
    passwordHash: await hashPassword(password),
  }).returning();

  if (invite) {
    const row = await db.query.invites.findFirst({ where: eq(invites.token, invite) });
    if (row && !row.acceptedAt) {
      await db.insert(memberships).values({ userId: user.id, brandId: row.brandId, role: row.role });
      await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.token, invite));
    }
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
