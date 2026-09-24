import Link from "next/link";
import {
  AlertTriangle, BarChart3, Building2, CalendarClock, CheckCircle2, Clock, FileEdit, Inbox, Layers, Plug, Rocket, Send, ThumbsUp, XCircle,
} from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getDashboard, getBrandChannels, getActivity } from "@/server/queries";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Badge, StatTile } from "@/components/ui";
import { ColumnChart, Ring, SegmentedBar } from "@/components/charts";
import { PostCard } from "@/components/post-card";
import { PlatformIcon } from "@/components/platform-icon";
import { BrandMark } from "@/components/brand-mark";
import { inZone, relativeTime, truncate, utcDays } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);

  if (brands.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Building2}
          title="Add your first brand"
          body="Each company or project you manage gets its own brand: its own channels, media library, calendar and team. Add them one at a time, or all ten now."
          action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>}
        />
      </Card>
    );
  }

  const scope = await getScope(brands);
  const [data, channels, activity] = await Promise.all([
    getDashboard(scope.brandIds),
    getBrandChannels(scope.brandIds),
    getActivity(scope.brandIds, 13, 7),
  ]);

  const days = utcDays(-13, 7);
  const chart = days.map((d) => ({
    label: d.offset === 0 ? "Today" : d.label,
    tip: d.tip,
    values: {
      published: d.offset <= 0 ? activity.published.get(d.key) ?? 0 : 0,
      scheduled: d.offset >= 0 ? activity.scheduled.get(d.key) ?? 0 : 0,
    },
  }));
  const pastWeek = (from: number, to: number) =>
    days.filter((d) => d.offset > from && d.offset <= to).reduce((n, d) => n + (activity.published.get(d.key) ?? 0), 0);
  const thisWeek = pastWeek(-7, 0);
  const lastWeek = pastWeek(-14, -7);
  const change = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
  const nextWeek = days.filter((d) => d.offset >= 0).map((d) => activity.scheduled.get(d.key) ?? 0);

  const c = (k: keyof typeof data.counts) => data.counts[k] ?? 0;
  const pipeline = [
    { key: "draft", label: "Drafts", value: c("draft"), color: "#8b8b96", icon: <FileEdit className="size-3" />, href: "/posts?status=draft" },
    { key: "review", label: "In review", value: c("in_review") + c("changes_requested"), color: "#d97706", icon: <Clock className="size-3" />, href: "/posts?status=in_review" },
    { key: "approved", label: "Approved", value: c("approved"), color: "#0d9488", icon: <ThumbsUp className="size-3" />, href: "/posts?status=approved" },
    { key: "scheduled", label: "Scheduled", value: c("scheduled") + c("publishing"), color: "#6366f1", icon: <CalendarClock className="size-3" />, href: "/posts?status=scheduled" },
    { key: "published", label: "Published", value: c("published") + c("partially_published"), color: "#16a34a", icon: <Rocket className="size-3" />, href: "/posts?status=published" },
    { key: "failed", label: "Failed", value: c("failed"), color: "#dc2626", icon: <XCircle className="size-3" />, href: "/posts?status=failed" },
  ];
  const pipelineTotal = pipeline.reduce((n, p) => n + p.value, 0);
  const live = channels.filter((ch) => ch.mode === "live").length;

  return (
    <>
      <PageHeader
        title={scope.activeBrand ? scope.activeBrand.name : "All brands"}
        mark={scope.activeBrand ? <BrandMark brand={scope.activeBrand} size={40} className="rounded-lg" /> : undefined}
        subtitle={
          scope.activeBrand
            ? [scope.activeBrand.tagline, `${channels.length} channel${channels.length === 1 ? "" : "s"}`, scope.activeBrand.timezone]
                .filter(Boolean).join(" · ")
            : `${brands.length} brands · ${channels.length} channels`
        }
        action={<LinkButton href="/posts/new" variant="primary">New post</LinkButton>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Needs approval" value={c("in_review")} href="/posts?status=in_review" icon={Clock} tone="#d97706"
          hint={c("in_review") ? "Waiting on a reviewer" : "All caught up"} />
        <StatTile label="Scheduled" value={c("scheduled")} href="/posts?status=scheduled" icon={Send} tone="#4f46e5"
          trend={nextWeek} hint="Next 7 days on the line" />
        <StatTile label="Ready to post" value={data.manualQueue.length} href="/queue" icon={CheckCircle2} tone="#0d9488"
          hint="Manual channels" />
        <StatTile label="Failed" value={data.failures.length} href="/queue?filter=failed" icon={AlertTriangle} tone="#dc2626"
          hint={data.failures.length ? "Needs a look" : "Nothing broken"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              icon={BarChart3}
              title="Publishing activity"
              subtitle={
                <>
                  <span className="font-medium text-text">{thisWeek}</span> deliveries in the last 7 days
                  {change !== 0 && (
                    <span className={change > 0 ? "text-ok" : "text-danger"}> · {change > 0 ? "▲" : "▼"} {Math.abs(change)}% vs the week before</span>
                  )}
                </>
              }
              action={<LinkButton href="/analytics" size="sm">Analytics</LinkButton>}
            />
            <div className="p-4">
              <ColumnChart
                data={chart}
                marker={days.findIndex((d) => d.offset === 0)}
                series={[
                  { key: "published", label: "Published", color: "var(--chart-1)" },
                  { key: "scheduled", label: "Scheduled", color: "var(--chart-2)" },
                ]}
                emptyLabel="Nothing published or scheduled in these three weeks"
              />
            </div>
          </Card>

          <Card>
            <CardHeader icon={Layers} title="Content pipeline" subtitle={`${pipelineTotal} post${pipelineTotal === 1 ? "" : "s"} across every stage`}
              action={<LinkButton href="/posts" size="sm">All content</LinkButton>} />
            <div className="p-4">
              <SegmentedBar parts={pipeline} />
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={CalendarClock}
              title="Next 7 days"
              subtitle="Everything approved or scheduled to go out this week"
              action={<LinkButton href="/calendar" size="sm">Calendar</LinkButton>}
            />
            <div className="space-y-2 p-3">
              {data.upcoming.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing scheduled this week" body="Plan a week for a brand and it shows up here." />
              ) : (
                data.upcoming.map((p) => <PostCard key={p.id} post={p} showBrand={!scope.activeBrand} />)
              )}
            </div>
          </Card>

          {data.failures.length > 0 && (
            <Card>
              <CardHeader icon={AlertTriangle} title="Failed publishes" subtitle="These need a look" />
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
              icon={Inbox}
              title="Waiting on you"
              subtitle="Submitted for approval"
              action={<LinkButton href="/posts?status=in_review" size="sm">All</LinkButton>}
            />
            <div className="space-y-2 p-3">
              {data.needsApproval.length === 0 ? (
                <p className="flex flex-col items-center gap-1.5 px-1 py-6 text-center text-sm text-muted">
                  <CheckCircle2 className="size-6 text-ok" /> Nothing to approve.
                </p>
              ) : (
                data.needsApproval.map((p) => <PostCard key={p.id} post={p} showBrand={!scope.activeBrand} />)
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={CheckCircle2}
              title="Ready to post"
              subtitle="Manual channels waiting for a human"
              action={<LinkButton href="/queue" size="sm">Queue</LinkButton>}
            />
            <ul className="divide-y divide-border">
              {data.manualQueue.length === 0 ? (
                <li className="flex flex-col items-center gap-1.5 px-4 py-6 text-center text-sm text-muted">
                  <CheckCircle2 className="size-6 text-ok" /> Queue is clear.
                </li>
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
            <CardHeader icon={Plug} title="Channels" action={<LinkButton href="/channels" size="sm">Manage</LinkButton>} />
            {channels.length > 0 && (
              <div className="flex items-center gap-4 border-b border-border px-4 py-3">
                <Ring value={live} total={channels.length} size={56}>{Math.round((live / channels.length) * 100)}%</Ring>
                <div className="space-y-1 text-xs">
                  <p className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-1" />
                    <span className="font-medium tabular-nums">{live}</span> <span className="text-muted">auto-publish (live API)</span></p>
                  <p className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-surface-2 ring-1 ring-border" />
                    <span className="font-medium tabular-nums">{channels.length - live}</span> <span className="text-muted">manual — posted by a human</span></p>
                </div>
              </div>
            )}
            {channels.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No channels connected yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {brands.filter((b) => scope.brandIds.includes(b.id)).map((b) => {
                  const mine = channels.filter((c) => c.brandId === b.id);
                  if (mine.length === 0) return null;
                  return (
                    <div key={b.id} className="p-3">
                      {!scope.activeBrand && (
                        <Link href={`/brands/${b.id}`} className="mb-2 flex items-center gap-2 hover:underline">
                          <BrandMark brand={b} size={18} />
                          <span className="truncate text-xs font-medium">{b.name}</span>
                          <span className="text-[11px] text-muted">{mine.length}</span>
                        </Link>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {mine.map((c) => (
                          <Badge key={c.id} color={c.mode === "live" ? "#15803d" : "#8b8b96"}>
                            <PlatformIcon platform={c.platform} size={13} variant="glyph" />
                            {c.handle}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
