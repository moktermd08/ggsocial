import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { Plus, LogOut } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, postTargets, posts } from "@/lib/db";
import { getEngagementCounts } from "@/server/queries";
import { countOpenPauses } from "@/server/workflows";
import { BrandSwitcher } from "@/components/brand-switcher";
import { GGSideNav, Nav } from "@/components/nav";
import { signOutAction } from "@/server/actions/auth";
import { buttonClass } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);

  const [queueRows, engagement, review] = await Promise.all([
    scope.brandIds.length
      ? db.select({ id: postTargets.id })
          .from(postTargets)
          .innerJoin(posts, eq(posts.id, postTargets.postId))
          .where(and(inArray(posts.brandId, scope.brandIds), inArray(postTargets.status, ["awaiting_manual", "failed"])))
      : Promise.resolve([]),
    getEngagementCounts(scope.brandIds),
    countOpenPauses(scope.brandIds),
  ]);
  const counts = { queue: queueRows.length, engage: engagement.overdue, review };
  const newHref = scope.isMaster ? "/posts/master/new" : "/posts/new";

  return (
    <div className="flex min-h-dvh">
      <div className="hidden shrink-0 md:block">
        <GGSideNav
          counts={counts}
          top={<div className="mb-2 px-1"><BrandSwitcher brands={brands} value={scope.value} /></div>}
          footer={
            <>
              <Link href={newHref} className={`${buttonClass("primary")} mb-3 w-full`}>
                <Plus className="size-4" /> {scope.isMaster ? "New master post" : "New post"}
              </Link>
              <div className="flex items-center gap-2 border-t border-border pt-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-text">
                  {user.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text">{user.name}</p>
                  <p className="truncate text-[11px] text-muted">{user.email}</p>
                </div>
                <form action={signOutAction}>
                  <button className="rounded-md p-1.5 text-muted hover:bg-surface-2" title="Sign out">
                    <LogOut className="size-4" />
                  </button>
                </form>
              </div>
            </>
          }
        />
      </div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link href="/" className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-accent to-chart-2 text-sm font-bold text-accent-fg shadow-sm">gg</Link>
          <div className="min-w-0 flex-1"><BrandSwitcher brands={brands} value={scope.value} /></div>
          <Link href={newHref} className={buttonClass("primary", "sm")}><Plus className="size-4" /></Link>
        </header>

        <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">{children}</div>

        <nav className="sticky bottom-0 z-20 border-t border-border bg-surface px-2 py-1 md:hidden">
          <Nav counts={counts} variant="bar" />
        </nav>
      </div>
    </div>
  );
}
