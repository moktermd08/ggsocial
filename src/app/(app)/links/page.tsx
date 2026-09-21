import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getLinks, getTrafficSummary, getBrandChannels } from "@/server/queries";
import { LinkTable, type LinkTableBrand } from "@/components/link-table";
import { PlatformIcon } from "@/components/platform-icon";
import { Card, CardHeader, PageHeader, StatTile } from "@/components/ui";
import { AreaChart, BarList } from "@/components/charts";
import { Globe, Link2, MousePointerClick, Repeat, TrendingUp, Users } from "lucide-react";
import { utcDays } from "@/lib/format";
import { appOrigin } from "@/lib/links";
import { platformOrNull } from "@/lib/platforms";

export default async function LinksPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);

  const [rows, traffic, channels] = await Promise.all([
    getLinks(scope.brandIds, { includeArchived: true }),
    getTrafficSummary(scope.brandIds, 30),
    getBrandChannels(scope.brandIds),
  ]);

  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const tableBrands: LinkTableBrand[] = inScope.map((b) => ({
    id: b.id,
    name: b.name,
    channels: channels.filter((c) => c.brandId === b.id).map((c) => ({ id: c.id, platform: c.platform, handle: c.handle })),
  }));

  const origin = appOrigin();
  const top = traffic.byPlatform.slice(0, 6);
  const perDay = new Map(traffic.byDay.map((d) => [d.day, d.clicks]));
  const series = utcDays(-29, 0, traffic.now).map((d) => ({ label: d.label, tip: d.tip, value: perDay.get(d.key) ?? 0 }));
  const activeLinks = rows.filter((l) => !l.archivedAt).length;

  return (
    <>
      <PageHeader
        icon={Link2}
        title="Traffic"
        subtitle="Tracked links, and what they actually sent. Last 30 days."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Clicks" value={traffic.clicks.toLocaleString()} icon={MousePointerClick} tone="#4f46e5"
          trend={series.map((d) => d.value)} hint="Bots filtered out" />
        <StatTile label="People" value={traffic.uniques.toLocaleString()} icon={Users} tone="#0d9488" hint="Unique visitors" />
        <StatTile label="Clicks per person" value={traffic.uniques ? (traffic.clicks / traffic.uniques).toFixed(1) : "—"}
          icon={Repeat} tone="#d97706" hint="Higher means they come back" />
        <StatTile label="Active links" value={activeLinks} icon={Link2} tone="#7c3aed" hint={`${rows.length - activeLinks} archived`} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader icon={TrendingUp} title="Clicks over time" subtitle="Per day, last 30 days" />
          <div className="p-4">
            <AreaChart data={series} label="Clicks" emptyLabel="No clicks yet — put a tracked link in a post" />
          </div>
        </Card>

        <Card>
          <CardHeader icon={Globe} title="Where they came from" subtitle="Clicks by source" />
          <div className="p-4">
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Nothing yet. Issue a link on a post, put it in the copy, and this fills in.
              </p>
            ) : (
              <BarList
                valueLabel="clicks"
                items={top.map((p) => ({
                  key: p.platform,
                  icon: p.platform === "direct"
                    ? <span className="grid size-4 shrink-0 place-items-center rounded bg-surface-2"><Globe className="size-3 text-muted" /></span>
                    : <PlatformIcon platform={p.platform} size={16} />,
                  label: platformOrNull(p.platform)?.name ?? (p.platform === "direct" ? "Direct / untagged" : p.platform),
                  sub: traffic.clicks ? `${Math.round((p.clicks / traffic.clicks) * 100)}%` : undefined,
                  value: p.clicks,
                }))}
              />
            )}
          </div>
        </Card>
      </div>

      <LinkTable
        rows={rows.map((l) => ({
          id: l.id,
          code: l.code,
          url: `${origin}/l/${l.code}`,
          label: l.label,
          destination: l.destination,
          brandId: l.brand.id,
          brandName: l.brand.name,
          brandColor: l.brand.color,
          platform: l.channel?.platform ?? null,
          handle: l.channel?.handle ?? null,
          post: l.post,
          utmCampaign: l.utmCampaign,
          clickCount: l.clickCount,
          uniqueCount: l.uniqueCount,
          lastClickAt: l.lastClickAt?.toISOString() ?? null,
          archived: Boolean(l.archivedAt),
        }))}
        brands={tableBrands}
        canEdit={inScope.some((b) => can.edit(b.role))}
        now={traffic.now}
      />
    </>
  );
}
