import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getLinks, getTrafficSummary, getBrandChannels } from "@/server/queries";
import { LinkTable, type LinkTableBrand } from "@/components/link-table";
import { PlatformIcon } from "@/components/platform-icon";
import { Card, PageHeader } from "@/components/ui";
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
  const mostClicks = top[0]?.clicks ?? 0;

  return (
    <>
      <PageHeader
        title="Traffic"
        subtitle="Tracked links, and what they actually sent. Last 30 days."
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[repeat(2,minmax(0,12rem))_minmax(0,1fr)]">
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Clicks</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{traffic.clicks.toLocaleString()}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">People</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{traffic.uniques.toLocaleString()}</p>
        </Card>

        <Card className="px-4 py-3">
          <p className="mb-2 text-xs text-muted">Where they came from</p>
          {top.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing yet. Issue a link on a post, put it in the copy, and this fills in.
            </p>
          ) : (
            <div className="space-y-1.5">
              {top.map((p) => (
                <div key={p.platform} className="flex items-center gap-2">
                  <span className="flex w-36 shrink-0 items-center gap-1.5 text-xs">
                    {p.platform === "direct"
                      ? <span className="size-4 shrink-0 rounded bg-surface-2" />
                      : <PlatformIcon platform={p.platform} size={16} />}
                    <span className="truncate">{platformOrNull(p.platform)?.name ?? "Untagged"}</span>
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${mostClicks > 0 ? Math.max(3, (p.clicks / mostClicks) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums">{p.clicks.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
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
