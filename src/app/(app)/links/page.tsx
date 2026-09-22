import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getLinks, getTrafficSummary, getBrandChannels } from "@/server/queries";
import { LinkTable, type LinkTableBrand } from "@/components/link-table";
import { PlatformIcon } from "@/components/platform-icon";
import Link from "next/link";
import { Badge, Card, CardHeader, LinkButton, PageHeader, StatTile } from "@/components/ui";
import { destinationOptionsByBrand, listBrandDestinations, listMasterDestinations } from "@/server/destinations";
import { AreaChart, BarList } from "@/components/charts";
import { Globe, Layers, Link2, MapPin, MousePointerClick, Repeat, TrendingUp, Users } from "lucide-react";
import { utcDays } from "@/lib/format";
import { appOrigin } from "@/lib/links";
import { platformOrNull } from "@/lib/platforms";

export default async function LinksPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);

  const [rows, traffic, channels, destinations, destinationOptions] = await Promise.all([
    getLinks(scope.brandIds, { includeArchived: true }),
    getTrafficSummary(scope.brandIds, 30),
    getBrandChannels(scope.brandIds),
    scope.isMaster ? listMasterDestinations(user.id, scope.brandIds) : listBrandDestinations(scope.brandIds),
    destinationOptionsByBrand(user.id, scope.brandIds),
  ]);
  const brandById = new Map(brands.map((b) => [b.id, b]));

  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const tableBrands: LinkTableBrand[] = inScope.map((b) => ({
    id: b.id,
    name: b.name,
    channels: channels.filter((c) => c.brandId === b.id).map((c) => ({ id: c.id, platform: c.platform, handle: c.handle })),
    destinations: destinationOptions[b.id] ?? [],
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
        action={<LinkButton href="/links/destinations/new" variant="subtle">New destination</LinkButton>}
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

      <Card className="mb-4">
        <CardHeader
          icon={scope.isMaster ? Layers : MapPin}
          title={scope.isMaster ? "Master destinations" : "Saved destinations"}
          subtitle={scope.isMaster
            ? "Landing pages every brand can issue links from. Change a URL once and every posted link follows."
            : "Where this brand's links send people. Master destinations are in the link pickers too."}
        />
        {destinations.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            None yet. Save a landing page once, then pick it whenever you issue links.{" "}
            <Link href="/links/destinations/new" className="text-accent underline">Add a destination</Link>
          </p>
        ) : (
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {destinations.map((d) => {
              const b = d.brandId ? brandById.get(d.brandId) : undefined;
              const behind = d.brandId ? d.pending.length : d.copies.filter((c) => c.pending.length).length;
              return (
                <Link key={d.id} href={`/links/destinations/${d.id}`} className="block rounded-lg border border-border p-2.5 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!d.brandId && <Badge>Master</Badge>}
                    {b && !scope.activeBrand && <Badge color={b.color}>{b.name}</Badge>}
                    {d.masterId && <Badge><Layers className="size-3" /> From master</Badge>}
                    {behind > 0 && (
                      <Badge color="#d97706">{d.brandId ? "Master changed" : `${behind} brand${behind === 1 ? "" : "s"} behind`}</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{d.name}</p>
                  <p className="truncate text-xs text-muted">{d.url}</p>
                  <p className="mt-1.5 text-[11px] text-muted">
                    {d.links} link{d.links === 1 ? "" : "s"} · {d.clicks.toLocaleString()} click{d.clicks === 1 ? "" : "s"}
                    {!d.brandId && d.copies.length > 0 ? ` · ${d.copies.length} brand cop${d.copies.length === 1 ? "y" : "ies"}` : ""}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

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
