"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { asResult } from "@/lib/action-result";
import { db, memberships, users, invites, ROLES, type Role } from "@/lib/db";
import { requireBrandRole } from "@/lib/auth";

function parseRole(raw: string): Role {
  if (!(ROLES as readonly string[]).includes(raw)) throw new Error("Pick a valid role.");
  return raw as Role;
}

/** Only an owner may hand out, change or take away ownership. */
function assertCanTouchOwner(actor: Role, ...roles: Array<Role | undefined>) {
  if (actor !== "owner" && roles.includes("owner")) throw new Error("Only an owner can change ownership.");
}

/** Sets one person's role on one brand; role "none" removes their access. */
export async function setUserAccessAction(userId: string, brandId: string, role: string) {
  return asResult(async () => {
    const { user, role: actor } = await requireBrandRole(brandId, "admin");
    const next = role === "none" ? null : parseRole(role);

    const current = await db.query.memberships.findFirst({
      where: and(eq(memberships.userId, userId), eq(memberships.brandId, brandId)),
    });
    assertCanTouchOwner(actor, current?.role, next ?? undefined);

    if (current?.role === "owner" && next !== "owner") {
      const owners = await db.query.memberships.findMany({
        where: and(eq(memberships.brandId, brandId), eq(memberships.role, "owner")),
      });
      if (owners.length <= 1) throw new Error("A brand needs at least one owner. Make someone else an owner first.");
    }
    if (userId === user.id && next === null) throw new Error("You cannot remove your own access here.");

    if (next === null) {
      await db.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.brandId, brandId)));
    } else if (current) {
      await db.update(memberships).set({ role: next })
        .where(and(eq(memberships.userId, userId), eq(memberships.brandId, brandId)));
    } else {
      await db.insert(memberships).values({ userId, brandId, role: next });
    }
    revalidatePath("/users");
    revalidatePath(`/brands/${brandId}`);
  });
}

/**
 * Adds a person to one or more brands with the same starting role. Someone who
 * already has an account is added straight away; otherwise each brand gets an
 * invite and the admin is handed the sign-up link (nothing is emailed).
 */
export async function addUserAction(formData: FormData) {
  return asResult(async () => {
    const email = String(formData.get("email") ?? "").toLowerCase().trim();
    const role = parseRole(String(formData.get("role") ?? "editor"));
    const brandIds = [...new Set(formData.getAll("brandId").map(String))];
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
    if (!brandIds.length) throw new Error("Pick at least one brand.");

    // Check every brand before writing anything, so a refusal leaves no half-done state.
    const actors = new Map<string, { user: { id: string }; role: Role }>();
    for (const brandId of brandIds) {
      const a = await requireBrandRole(brandId, "admin");
      assertCanTouchOwner(a.role, role);
      actors.set(brandId, a);
    }

    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      for (const brandId of brandIds) {
        await db.insert(memberships).values({ userId: existing.id, brandId, role }).onConflictDoNothing();
      }
      revalidatePath("/users");
      return { added: true as const, email };
    }

    const tokens: string[] = [];
    for (const brandId of brandIds) {
      const [invite] = await db.insert(invites)
        .values({ email, brandId, role, invitedBy: actors.get(brandId)!.user.id })
        .returning();
      tokens.push(invite.token);
    }
    revalidatePath("/users");
    // Signing up through this link also claims the person's other open invites.
    return { added: false as const, email, inviteUrl: `/signup?invite=${tokens[0]}` };
  });
}

/** Withdraws an invite that has not been used yet. */
export async function revokeInviteAction(token: string) {
  return asResult(async () => {
    const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) });
    if (!invite) return;
    await requireBrandRole(invite.brandId, "admin");
    await db.delete(invites).where(eq(invites.token, token));
    revalidatePath("/users");
  });
}
