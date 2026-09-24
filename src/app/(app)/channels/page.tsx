import { eq } from "drizzle-orm";
import { Plug, Building2, AlertTriangle, CircleCheck } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, channels as channelsTable } from "@/lib/db";
import { getBrandChannels } from "@/server/queries";
import { platformMeta, hasPublicPage } from "@/lib/platforms/meta";
import { getPlatform } from "@/lib/platforms";
import { CHANNEL_PROVIDERS, channelAuthConfigured, heldCandidates, providerFor } from "@/server/channel-auth";
import { ChannelManager } from "@/components/channel-manager";
import { ConnectPicker } from "@/components/channel-connect";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default async function ChannelsPage({ searchParams }: {
  searchParams: Promise<{ connected?: string; connectError?: string; pick?: string }>;
}) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const channels = await getBrandChannels(scope.brandIds);
  const platforms = platformMeta();
  const shown = scope.activeBrand ? brands.filter((b) => b.id === scope.activeBrand!.id) : brands;
  const { connected, connectError, pick } = await searchParams;

  // A sign-in that reached several accounts: names and handles only — the tokens stay on the server.
  const held = pick ? await heldCandidates(pick, user.id) : null;
  const pickFor = held ? await db.query.channels.findFirst({ where: eq(channelsTable.id, held.channelId) }) : null;

  const signIn = (platform: string, channelId: string) => {
    const provider = providerFor(platform);
    if (!provider) return null;
    const cfg = CHANNEL_PROVIDERS[provider];
    return {
      href: `/api/channels/connect/${provider}/start?channelId=${encodeURIComponent(channelId)}`,
      label: `Connect with ${cfg.name}`,
      configured: channelAuthConfigured(provider),
      hint: `Add ${cfg.clientIdEnv} and ${cfg.clientSecretEnv} to the server's .env (see the deploy guide).`,
    };
  };

  return (
    <>
      <PageHeader
        icon={Plug}
        title="Channels"
        subtitle="Every account, per brand. Manual channels work immediately; connected ones publish by themselves and bring their comments into Engagement."
      />

      {connectError && (
        <Card className="mb-5 flex items-start gap-3 border-danger/40 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="text-sm text-text">{connectError}</p>
        </Card>
      )}
      {connected && !connectError && (
        <Card className="mb-5 flex items-start gap-3 p-4">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          <p className="text-sm text-text">Connected. The channel now publishes by itself, and its comments come into Engagement.</p>
        </Card>
      )}
      {pick && !held && (
        <Card className="mb-5 flex items-start gap-3 border-danger/40 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="text-sm text-text">That sign-in has expired. Connect the channel again.</p>
        </Card>
      )}
      {held && pickFor && (
        <ConnectPicker
          connectionId={pick!}
          channelLabel={`${pickFor.handle} (${getPlatform(pickFor.platform).name})`}
          accounts={held.candidates.map((c) => ({ externalId: c.externalId, name: c.name, handle: c.handle }))}
        />
      )}

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
                  pageUrl: c.pageUrl, pageStatus: c.pageStatus, pageNote: c.pageNote,
                  hasPublicPage: hasPublicPage(c.platform),
                  pageCheckedAt: c.pageCheckedAt?.toISOString() ?? null,
                  signIn: signIn(c.platform, c.id),
                }))}
            />
          ))}
        </div>
      )}
    </>
  );
}
