import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Users } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { db, invites, memberships, users } from "@/lib/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const me = await requireUser();
  const mine = await getMyBrands(me.id);
  const managed = mine.filter((b) => can.manageTeam(b.role));

  if (managed.length === 0) {
    return (
      <>
        <PageHeader icon={Users} title="Users" subtitle="Who can sign in, and what they can do on each brand." />
        <Card>
          <EmptyState
            icon={Users}
            title="Nothing to manage"
            body="You need to be an admin or owner of a brand to add people to it and set their permissions."
          />
        </Card>
      </>
    );
  }

  const brandIds = managed.map((b) => b.id);
  const [rows, pending] = await Promise.all([
    db.select({ userId: users.id, name: users.name, email: users.email, brandId: memberships.brandId, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(inArray(memberships.brandId, brandIds))
      .orderBy(asc(users.name)),
    db.select().from(invites).where(and(inArray(invites.brandId, brandIds), isNull(invites.acceptedAt))),
  ]);

  const people = new Map<string, { id: string; name: string; email: string; access: Record<string, string> }>();
  for (const r of rows) {
    const p = people.get(r.userId) ?? { id: r.userId, name: r.name, email: r.email, access: {} };
    p.access[r.brandId] = r.role;
    people.set(r.userId, p);
  }

  return (
    <>
      <PageHeader
        icon={Users}
        title="Users"
        subtitle="Add people and choose what each can do on every brand you manage."
      />
      <UsersManager
        currentUserId={me.id}
        brands={managed.map((b) => ({ id: b.id, name: b.name, myRole: b.role }))}
        people={[...people.values()]}
        invites={pending.map((i) => ({ token: i.token, email: i.email, brandId: i.brandId, role: i.role }))}
      />
    </>
  );
}
