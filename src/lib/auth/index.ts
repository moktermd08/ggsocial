import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, users, memberships, brands, type Role } from "@/lib/db";
import { readSession } from "./session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
};

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const row = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { id: true, email: true, name: true, avatarUrl: true, isSuperAdmin: true },
  });
  return row ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type BrandWithRole = typeof brands.$inferSelect & { role: Role };

/** Every brand the current user can see, ordered by name. */
export const getMyBrands = cache(async (userId: string): Promise<BrandWithRole[]> => {
  const rows = await db
    .select({ brand: brands, role: memberships.role })
    .from(memberships)
    .innerJoin(brands, eq(brands.id, memberships.brandId))
    .where(and(eq(memberships.userId, userId), isNull(brands.archivedAt)))
    .orderBy(brands.name);
  return rows.map((r) => ({ ...r.brand, role: r.role }));
});

const RANK: Record<Role, number> = { viewer: 0, approver: 1, editor: 2, admin: 3, owner: 4 };

export function atLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

/** Role checks used across the UI and every server action. */
export const can = {
  view: (r: Role) => atLeast(r, "viewer"),
  comment: (r: Role) => atLeast(r, "viewer"),
  edit: (r: Role) => atLeast(r, "editor"),
  approve: (r: Role) => r === "approver" || atLeast(r, "admin"),
  publish: (r: Role) => atLeast(r, "editor"),
  manageChannels: (r: Role) => atLeast(r, "admin"),
  manageTeam: (r: Role) => atLeast(r, "admin"),
  manageBrand: (r: Role) => atLeast(r, "admin"),
};

export async function getMembership(userId: string, brandId: string) {
  return db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.brandId, brandId)),
  });
}

/** Throws unless the user holds at least `min` on that brand. */
export async function requireBrandRole(brandId: string, min: Role = "viewer") {
  const user = await requireUser();
  const m = await getMembership(user.id, brandId);
  if (!m || !atLeast(m.role, min)) {
    throw new Error("You do not have permission to do that on this brand.");
  }
  return { user, role: m.role };
}
