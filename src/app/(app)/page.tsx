import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Send } from "lucide-react";
import { tintedInk } from "@/lib/color";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getDashboard, getBrandChannels } from "@/server/queries";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Badge } from "@/components/ui";
import { PostCard } from "@/components/post-card";
import { PlatformIcon } from "@/components/platform-icon";
import { inZone, relativeTime, truncate } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);

  if (brands.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Add your first brand"
          body="Each company or project you manage gets its own brand: its own channels, media library, calendar and team. Add them one at a time, or all ten now."
          action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>}
        />
      </Card>
    );
  }

  const scope = await getScope(brands);
  const [data, channels] = await Promise.all([
    getDashboard(scope.brandIds),
    getBrandChannels(scope.brandIds),
  ]);

  const stats = [
    { label: "Needs approval", value: data.counts.in_review ?? 0, href: "/posts?status=in_review", icon: Clock, tone: "#b45309" },
    { label: "Scheduled", value: data.counts.scheduled ?? 0, href: "/posts?status=scheduled", icon: Send, tone: "#4f46e5" },
    { label: "Ready to post", value: data.manualQueue.length, href: "/queue", icon: CheckCircle2, tone: "#0f766e" },
    { label: "Failed", value: data.failures.length, href: "/queue?filter=failed", icon: AlertTriangle, tone: "#b91c1c" },
  ];

  return (
    <>
      <PageHeader
        title={scope.activeBrand ? scope.activeBrand.name : "All brands"}
        subtitle={
          scope.activeBrand
            ? `${channels.length} channel${channels.length === 1 ? "" : "s"} · ${scope.activeBrand.timezone}`
            : `${brands.length} brands · ${channels.length} channels`
        }
        action={<LinkButton href="/posts/new" variant="primary">New post</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <s.icon className="size-3.5" style={{ color: tintedInk(s.tone, 75) }} />
              {s.label}
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Next 7 days"
              subtitle="Everything approved or scheduled to go out this week"
              action={<LinkButton href="/calendar" size="sm">Calendar</LinkButton>}
            />
            <div className="space-y-2 p-3">
              {data.upcoming.length === 0 ? (
                <EmptyState title="Nothing scheduled this week" body="Plan a week for a brand and it shows up here." />
              ) : (
                data.upcoming.map((p) => <PostCard key={p.id} post={p} showBrand={!scope.activeBrand} />)
              )}
            </div>
          </Card>

          {data.failures.length > 0 && (
            <Card>
              <CardHeader title="Failed publishes" subtitle="These need a look" />
              <ul className="divide-y divide-border">
                {data.failures.map((f) => (
                  <li key={f.target.id} className="flex items-start gap-3 px-4 py-3">
                    <PlatformIcon platform={f.channel.platform} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/posts/${f.post.id}`} className="text-sm font-medium hover:underline">
                        {f.post.title || truncate(f.post.body, 50) || "Untitled"}
                      </Link>
                      <p className="mt-0.5 text-xs text-danger">{truncate(f.target.lastError ?? "Unknown error", 160)}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{relativeTime(f.target.scheduledAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Waiting on you"
              subtitle="Submitted for approval"
              action={<LinkButton href="/posts?status=in_review" size="sm">All</LinkButton>}
            />
            <div className="space-y-2 p-3">
              {data.needsApproval.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted">Nothing to approve.</p>
              ) : (
                data.needsApproval.map((p) => <PostCard key={p.id} post={p} showBrand={!scope.activeBrand} />)
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Ready to post"
              subtitle="Manual channels waiting for a human"
              action={<LinkButton href="/queue" size="sm">Queue</LinkButton>}
            />
            <ul className="divide-y divide-border">
              {data.manualQueue.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-muted">Queue is clear.</li>
              ) : (
                data.manualQueue.slice(0, 6).map((q) => (
                  <li key={q.target.id} className="flex items-center gap-3 px-4 py-2.5">
                    <PlatformIcon platform={q.channel.platform} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{q.post.title || truncate(q.post.body, 40)}</p>
                      <p className="text-[11px] text-muted">{q.channel.handle}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted">{inZone(q.target.scheduledAt, "UTC", { month: "short" })}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Channels" action={<LinkButton href="/channels" size="sm">Manage</LinkButton>} />
            <div className="flex flex-wrap gap-1.5 p-3">
              {channels.length === 0 ? (
                <p className="px-1 py-3 text-sm text-muted">No channels connected yet.</p>
              ) : (
                channels.map((c) => (
                  <Badge key={c.id} color={c.mode === "live" ? "#15803d" : "#8b8b96"}>
                    <PlatformIcon platform={c.platform} size={13} variant="glyph" />
                    {c.handle}
                  </Badge>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
