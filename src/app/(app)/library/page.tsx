import { Images, Building2 } from "lucide-react";
import { desc, inArray } from "drizzle-orm";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, media } from "@/lib/db";
import { MediaLibrary } from "@/components/media-library";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default async function LibraryPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const shown = scope.activeBrand ? brands.filter((b) => b.id === scope.activeBrand!.id) : brands;

  const rows = scope.brandIds.length
    ? await db.select().from(media).where(inArray(media.brandId, scope.brandIds)).orderBy(desc(media.createdAt))
    : [];

  return (
    <>
      <PageHeader icon={Images} title="Media" subtitle="Assets live per brand, so nothing crosses between clients by accident." />
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
              items={rows.filter((m) => m.brandId === b.id).map((m) => ({
                id: m.id, url: m.url, kind: m.kind, originalName: m.originalName,
                size: m.size, createdAt: m.createdAt.toISOString(),
              }))}
            />
          ))}
        </div>
      )}
    </>
  );
}
