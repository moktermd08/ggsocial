import { PenSquare, Inbox, Layers } from "lucide-react";
import Link from "next/link";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getPosts } from "@/server/queries";
import { PostCard } from "@/components/post-card";
import { MasterCard } from "@/components/master-card";
import { listMasters } from "@/server/masters";
import { Card, EmptyState, LinkButton, PageHeader, buttonClass } from "@/components/ui";
import { PLATFORMS_BY_CATEGORY } from "@/lib/platforms";
import { CATEGORY_LABELS } from "@/lib/platforms/types";
import type { PostStatus } from "@/lib/db";

const FILTERS: { key: string; label: string; statuses?: PostStatus[] }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts", statuses: ["draft", "changes_requested"] },
  { key: "in_review", label: "Needs approval", statuses: ["in_review"] },
  { key: "scheduled", label: "Scheduled", statuses: ["scheduled", "approved"] },
  { key: "published", label: "Published", statuses: ["published", "partially_published"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
];

export default async function PostsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; platform?: string; q?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { status = "all", platform, q } = await searchParams;

  if (scope.isMaster) {
    const masters = await listMasters(user.id, brands.map((b) => b.id), q);
    const chips = new Map(brands.map((b) => [b.id, { id: b.id, name: b.name, color: b.color }]));
    return (
      <>
        <PageHeader
          icon={Layers}
          title="Master content"
          subtitle={`${masters.length} master post${masters.length === 1 ? "" : "s"}. Each brand works from a linked copy.`}
          action={<LinkButton href="/posts/master/new" variant="primary">New master post</LinkButton>}
        />
        <form className="mb-4 flex justify-end gap-2" action="/posts">
          <input name="q" defaultValue={q} placeholder="Search masters…" className="!w-56 !py-1 !text-sm" />
          <button className={buttonClass("subtle", "sm")}>Search</button>
        </form>
        {masters.length === 0 ? (
          <Card>
            <EmptyState
              icon={Layers}
              title="No master posts yet"
              body="Write a piece once here and every brand gets a linked copy to adapt in its own voice."
              action={<LinkButton href="/posts/master/new" variant="primary">Write a master post</LinkButton>}
            />
          </Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {masters.map((m) => <MasterCard key={m.id} master={m} brands={chips} />)}
          </div>
        )}
      </>
    );
  }

  const filter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const posts = await getPosts({ brandIds: scope.brandIds, statuses: filter.statuses, platform, search: q });

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(platform ? { platform } : {}), ...(q ? { q } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const s = p.toString();
    return s ? `/posts?${s}` : "/posts";
  };

  return (
    <>
      <PageHeader
        icon={PenSquare}
        title="Content"
        subtitle={`${posts.length} post${posts.length === 1 ? "" : "s"}${scope.activeBrand ? ` in ${scope.activeBrand.name}` : " across all brands"}`}
        action={<LinkButton href="/posts/new" variant="primary">New post</LinkButton>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={qs({ status: f.key === "all" ? undefined : f.key })}
            className={`${buttonClass(status === f.key ? "primary" : "subtle", "sm")}`}
          >
            {f.label}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <form className="ml-auto flex flex-wrap items-center gap-2" action="/posts">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <select name="platform" defaultValue={platform ?? ""} className="!w-44 !py-1 !text-sm">
            <option value="">Any platform</option>
            {PLATFORMS_BY_CATEGORY.map((g) => (
              <optgroup key={g.category} label={CATEGORY_LABELS[g.category]}>
                {g.platforms.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input name="q" defaultValue={q} placeholder="Search copy…" className="!w-48 !py-1 !text-sm" />
          <button className={buttonClass("subtle", "sm")}>Filter</button>
        </form>
      </div>

      {posts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Nothing here yet"
            body={`No ${filter.label.toLowerCase()} posts${scope.activeBrand ? ` for ${scope.activeBrand.name}` : ""}.`}
            action={<LinkButton href="/posts/new" variant="primary">Write something</LinkButton>}
          />
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => <PostCard key={p.id} post={p} showBrand={!scope.activeBrand} />)}
        </div>
      )}
    </>
  );
}
