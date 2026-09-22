import { Images, Building2 } from "lucide-react";
import { desc, eq, inArray } from "drizzle-orm";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, media, integrations, INTEGRATION_PROVIDERS } from "@/lib/db";
import { MediaLibrary } from "@/components/media-library";
import { SourceConnections, type SourceStatus } from "@/components/media-sources";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { isConfigured, PROVIDERS } from "@/server/integrations/oauth";

export default async function LibraryPage({ searchParams }: {
  searchParams: Promise<{ connected?: string; integrationError?: string }>;
}) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const shown = scope.activeBrand ? brands.filter((b) => b.id === scope.activeBrand!.id) : brands;
  const { connected, integrationError } = await searchParams;

  const [rows, linked] = await Promise.all([
    scope.brandIds.length
      ? db.select().from(media).where(inArray(media.brandId, scope.brandIds)).orderBy(desc(media.createdAt))
      : [],
    db.select({ provider: integrations.provider, accountName: integrations.accountName })
      .from(integrations).where(eq(integrations.userId, user.id)),
  ]);

  const sources: SourceStatus[] = INTEGRATION_PROVIDERS.map((p) => {
    const link = linked.find((l) => l.provider === p);
    const cfg = PROVIDERS[p];
    return {
      provider: p,
      name: cfg.name,
      configured: isConfigured(p),
      connected: Boolean(link),
      accountName: link?.accountName ?? null,
      envHint: `${cfg.clientIdEnv} and ${cfg.clientSecretEnv}`,
    };
  });
  const connectedName = connected && connected in PROVIDERS ? PROVIDERS[connected as keyof typeof PROVIDERS].name : null;

  return (
    <>
      <PageHeader icon={Images} title="Media" subtitle="Assets live per brand, so nothing crosses between clients by accident." />
      {connectedName && (
        <p className="mb-4 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
          {connectedName} connected. Use its button on any brand below to import.
        </p>
      )}
      {integrationError && (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{integrationError}</p>
      )}
      <SourceConnections sources={sources} />
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No brands yet" action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>} />
        </Card>
      ) : (
        <div className="space-y-5">
          {shown.map((b) => (
            <MediaLibrary
              key={b.id}
              brandId={b.id}
              brandName={b.name}
              canEdit={can.edit(b.role)}
              sources={sources}
              items={rows.filter((m) => m.brandId === b.id).map((m) => ({
                id: m.id, url: m.url, kind: m.kind, originalName: m.originalName,
                size: m.size, createdAt: m.createdAt.toISOString(),
                source: m.source, sourceUrl: m.sourceUrl,
              }))}
            />
          ))}
        </div>
      )}
    </>
  );
}
