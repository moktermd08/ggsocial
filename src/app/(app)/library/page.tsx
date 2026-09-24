import { Images, Building2 } from "lucide-react";
import { eq } from "drizzle-orm";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, integrations, INTEGRATION_PROVIDERS } from "@/lib/db";
import { brandLibraries, brandVersions, masterAssets, masterOwnersFor, type LibraryItem, type MediaFile } from "@/server/media-library";
import { MediaLibrary } from "@/components/media-library";
import { withInheritedCatalog } from "@/server/media-catalog";
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

  const allIds = brands.map((b) => b.id);
  const [libraries, masters, linked] = await Promise.all([
    scope.isMaster ? new Map<string, LibraryItem[]>() : brandLibraries(user.id, shown.map((b) => b.id)),
    scope.isMaster ? masterOwnersFor(user.id, allIds).then(masterAssets) : [],
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
  /** How a file is filed, as the library card and its editor read it. */
  const catalog = (m: MediaFile) => ({
    width: m.width, height: m.height, altText: m.altText, tags: m.tags,
    category: m.category, subcategory: m.subcategory, uses: m.uses, usageNotes: m.usageNotes,
    catalogedAt: m.catalogedAt?.toISOString() ?? null, catalogedBy: m.catalogedBy,
  });

  async function masterItems() {
    const versions = await brandVersions(allIds, masters.map((m) => m.id));
    return masters.map((m) => ({
      id: m.id, url: m.url, kind: m.kind, originalName: m.originalName,
      size: m.size, createdAt: m.createdAt.toISOString(), source: m.source, sourceUrl: m.sourceUrl,
      canDelete: m.ownerId === user.id,
      canCatalog: m.ownerId === user.id,
      ...catalog(m),
      versions: brands.filter((b) => versions.get(b.id)?.has(m.id)).map((b) => ({ brandName: b.name, brandColor: b.color })),
    }));
  }

  const connectedName = connected && connected in PROVIDERS ? PROVIDERS[connected as keyof typeof PROVIDERS].name : null;

  return (
    <>
      <PageHeader
        icon={Images}
        title={scope.isMaster ? "Master library" : "Media"}
        subtitle={scope.isMaster
          ? "Assets every brand can use. A brand can upload its own version of any of them, and that version is used in its posts instead."
          : "Each brand's own files, plus the master library. Switch to Master to add shared assets."}
      />
      {connectedName && (
        <p className="mb-4 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
          {connectedName} connected. Use its button on any brand below to import.
        </p>
      )}
      {integrationError && (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{integrationError}</p>
      )}
      <SourceConnections sources={sources} />
      {scope.isMaster ? (
        <MediaLibrary
          brandId={null}
          brandName="Master library"
          canEdit
          items={await masterItems()}
        />
      ) : shown.length === 0 ? (
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
              items={(libraries.get(b.id) ?? []).map(withInheritedCatalog).map((m) => ({
                id: m.id, url: m.url, kind: m.kind, originalName: m.originalName,
                size: m.size, createdAt: m.createdAt.toISOString(),
                source: m.source, sourceUrl: m.sourceUrl,
                isMaster: m.isMaster, versionOf: m.versionOf?.originalName ?? null,
                canCatalog: m.isMaster ? m.ownerId === user.id : can.edit(b.role),
                ...catalog(m),
              }))}
            />
          ))}
        </div>
      )}
    </>
  );
}
