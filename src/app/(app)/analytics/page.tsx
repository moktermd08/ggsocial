import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getAnalytics } from "@/server/queries";
import { Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { inZone, truncate } from "@/lib/format";

const RANGES = [7, 30, 90];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { days } = await searchParams;
  const window = RANGES.includes(Number(days)) ? Number(days) : 30;

  const rows = await getAnalytics(scope.brandIds, window);

  const byPlatform = new Map<string, { posts: number; impressions: number; engagements: number }>();
  for (const r of rows) {
    const cur = byPlatform.get(r.channel.platform) ?? { posts: 0, impressions: 0, engagements: 0 };
    cur.posts += 1;
    cur.impressions += r.metrics?.impressions ?? 0;
    cur.engagements += (r.metrics?.likes ?? 0) + (r.metrics?.commentCount ?? 0) + (r.metrics?.shares ?? 0) + (r.metrics?.saves ?? 0);
    byPlatform.set(r.channel.platform, cur);
  }
  const maxPosts = Math.max(1, ...[...byPlatform.values()].map((v) => v.posts));
  const liveNumbers = rows.some((r) => r.metrics);

  return (
    <>
      <PageHeader
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

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Output by platform" subtitle="Posts shipped in this window" />
          <div className="space-y-2.5 p-4">
            {byPlatform.size === 0 && <p className="py-4 text-center text-sm text-muted">No published posts yet.</p>}
            {[...byPlatform.entries()].sort((a, b) => b[1].posts - a[1].posts).map(([platform, v]) => (
              <div key={platform}>
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <PlatformIcon platform={platform} size={16} />
                  <span className="flex-1 capitalize">{platform}</span>
                  <span className="tabular-nums text-muted">{v.posts}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(v.posts / maxPosts) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Published posts" />
          {rows.length === 0 ? (
            <EmptyState title="Nothing published yet" body="Once posts go out, they show up here with whatever metrics the platform gives back." />
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
