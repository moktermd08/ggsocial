import Link from "next/link";
import { BarChart3, ExternalLink, Eye, Heart, Rocket, Share2, Table2, TrendingUp } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getAnalytics } from "@/server/queries";
import { Card, CardHeader, EmptyState, PageHeader, StatTile, buttonClass } from "@/components/ui";
import { BarList, ColumnChart, type ChartSeries } from "@/components/charts";
import { platformOrNull } from "@/lib/platforms";
import { PlatformIcon } from "@/components/platform-icon";
import { inZone, truncate, utcDays } from "@/lib/format";

const RANGES = [7, 30, 90];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { days } = await searchParams;
  const window = RANGES.includes(Number(days)) ? Number(days) : 30;

  // Fetch two windows so every headline number can say how it moved.
  const both = await getAnalytics(scope.brandIds, window * 2);
  // Whole UTC days, so the headline numbers and the daily chart agree.
  const calendar = utcDays(-(window - 1), 0);
  const dayOf = (r: (typeof both)[number]) => r.target.publishedAt?.toISOString().slice(0, 10) ?? "";
  const rows = both.filter((r) => dayOf(r) >= calendar[0].key);
  const prev = both.filter((r) => dayOf(r) < calendar[0].key);

  const byPlatform = new Map<string, { posts: number; impressions: number; engagements: number }>();
  for (const r of rows) {
    const cur = byPlatform.get(r.channel.platform) ?? { posts: 0, impressions: 0, engagements: 0 };
    cur.posts += 1;
    cur.impressions += r.metrics?.impressions ?? 0;
    cur.engagements += (r.metrics?.likes ?? 0) + (r.metrics?.commentCount ?? 0) + (r.metrics?.shares ?? 0) + (r.metrics?.saves ?? 0);
    byPlatform.set(r.channel.platform, cur);
  }
  const liveNumbers = rows.some((r) => r.metrics);
  const ranked = [...byPlatform.entries()].sort((a, b) => b[1].posts - a[1].posts);

  const sum = (list: typeof rows, f: (r: (typeof rows)[number]) => number) => list.reduce((n, r) => n + f(r), 0);
  const impressions = (r: (typeof rows)[number]) => r.metrics?.impressions ?? 0;
  const engagements = (r: (typeof rows)[number]) =>
    (r.metrics?.likes ?? 0) + (r.metrics?.commentCount ?? 0) + (r.metrics?.shares ?? 0) + (r.metrics?.saves ?? 0);
  const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : 0);
  const totalImpr = sum(rows, impressions);
  const totalEng = sum(rows, engagements);

  // Daily output, stacked by the three busiest platforms; the rest fold into "Other".
  const leaders = ranked.slice(0, 3).map(([p]) => p);
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
  const series: ChartSeries[] = [
    ...leaders.map((p, i) => ({ key: p, label: platformOrNull(p)?.name ?? p, color: colors[i] })),
    ...(ranked.length > 3 ? [{ key: "other", label: "Other", color: "#8b8b96" }] : []),
  ];
  const perDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const key = dayOf(r);
    const bucket = perDay.get(key) ?? {};
    const k = leaders.includes(r.channel.platform) ? r.channel.platform : "other";
    bucket[k] = (bucket[k] ?? 0) + 1;
    perDay.set(key, bucket);
  }
  const daily = calendar.map((d) => ({ label: d.label, tip: d.tip, values: perDay.get(d.key) ?? {} }));
  const dailyCounts = calendar.map((d) => Object.values(perDay.get(d.key) ?? {}).reduce((a, b) => a + b, 0));

  return (
    <>
      <PageHeader
        icon={BarChart3}
        title="Analytics"
        subtitle={`${rows.length} published post${rows.length === 1 ? "" : "s"} in the last ${window} days`}
        action={
          <div className="flex gap-2">
            {RANGES.map((d) => (
              <Link key={d} href={`/analytics?days=${d}`} className={buttonClass(d === window ? "primary" : "subtle", "sm")}>
                {d}d
              </Link>
            ))}
          </div>
        }
      />

      {!liveNumbers && rows.length > 0 && (
        <p className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
          Engagement numbers arrive once a channel is connected in live mode — the platforms only hand out insights for
          posts their API published. Output volume below is tracked for every channel, manual included.
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Deliveries" value={rows.length} icon={Rocket} tone="#4f46e5" trend={dailyCounts}
          delta={{ value: pct(rows.length, prev.length) }} hint={`vs ${prev.length} the ${window} days before`} />
        <StatTile label="Platforms reached" value={byPlatform.size} icon={Share2} tone="#0d9488"
          hint={ranked[0] ? `Busiest: ${platformOrNull(ranked[0][0])?.name ?? ranked[0][0]}` : "None yet"} />
        <StatTile label="Impressions" value={liveNumbers ? totalImpr.toLocaleString() : "—"} icon={Eye} tone="#7c3aed"
          delta={liveNumbers ? { value: pct(totalImpr, sum(prev, impressions)) } : undefined} hint={liveNumbers ? undefined : "Live channels only"} />
        <StatTile label="Engagements" value={liveNumbers ? totalEng.toLocaleString() : "—"} icon={Heart} tone="#db2777"
          delta={liveNumbers ? { value: pct(totalEng, sum(prev, engagements)) } : undefined}
          hint={liveNumbers && totalImpr > 0 ? `${((totalEng / totalImpr) * 100).toFixed(1)}% engagement rate` : "Likes, comments, shares, saves"} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader icon={TrendingUp} title="Daily output" subtitle={`Deliveries per day, by platform · last ${window} days`} />
          <div className="p-4">
            <ColumnChart data={daily} series={series} emptyLabel="Nothing published in this window" />
          </div>
        </Card>

        <Card>
          <CardHeader icon={Share2} title="Output by platform" subtitle="Share of deliveries in this window" />
          <div className="p-4">
            {byPlatform.size === 0 ? (
              <p className="py-4 text-center text-sm text-muted">No published posts yet.</p>
            ) : (
              <BarList
                valueLabel="deliveries"
                items={ranked.map(([platform, v]) => ({
                  key: platform,
                  icon: <PlatformIcon platform={platform} size={16} />,
                  label: platformOrNull(platform)?.name ?? platform,
                  sub: `${Math.round((v.posts / rows.length) * 100)}%`,
                  value: v.posts,
                }))}
              />
            )}
          </div>
        </Card>
      </div>

      <div>
        <Card className="overflow-hidden">
          <CardHeader icon={Table2} title="Published posts" />
          {rows.length === 0 ? (
            <EmptyState icon={Rocket} title="Nothing published yet" body="Once posts go out, they show up here with whatever metrics the platform gives back." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Post</th>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 text-right font-medium">Impr.</th>
                    <th className="px-3 py-2 text-right font-medium">Likes</th>
                    <th className="px-3 py-2 text-right font-medium">Comments</th>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.target.id} className="hover:bg-surface-2">
                      <td className="max-w-64 px-4 py-2">
                        <Link href={`/posts/${r.post.id}`} className="hover:underline">
                          {r.post.title || truncate(r.post.body, 40)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs">
                          <PlatformIcon platform={r.channel.platform} size={14} /> {r.channel.handle}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.metrics?.impressions ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.metrics?.likes ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.metrics?.commentCount ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{inZone(r.target.publishedAt, "UTC")}</td>
                      <td className="px-3 py-2">
                        {r.target.externalUrl && (
                          <a href={r.target.externalUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-accent">
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
