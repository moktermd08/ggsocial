import { Plug, Building2 } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getBrandChannels } from "@/server/queries";
import { platformMeta } from "@/lib/platforms/meta";
import { ChannelManager } from "@/components/channel-manager";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default async function ChannelsPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const channels = await getBrandChannels(scope.brandIds);
  const platforms = platformMeta();
  const shown = scope.activeBrand ? brands.filter((b) => b.id === scope.activeBrand!.id) : brands;

  return (
    <>
      <PageHeader
        icon={Plug}
        title="Channels"
        subtitle="Every account, per brand. Manual channels work immediately; connected ones publish by themselves."
      />

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No brands yet" action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>} />
        </Card>
      ) : (
        <div className="space-y-5">
          {shown.map((b) => (
            <ChannelManager
              key={b.id}
              brandId={b.id}
              brandName={b.name}
              canManage={can.manageChannels(b.role)}
              platforms={platforms}
              channels={channels
                .filter((c) => c.brandId === b.id)
                .map((c) => ({
                  id: c.id, platform: c.platform, handle: c.handle, displayName: c.displayName,
                  mode: c.mode, status: c.status, hasCredentials: Boolean(c.credentials),
                  settings: (c.settings ?? {}) as Record<string, unknown>,
                  lastError: c.lastError, externalId: c.externalId,
                }))}
            />
          ))}
        </div>
      )}
    </>
  );
}
