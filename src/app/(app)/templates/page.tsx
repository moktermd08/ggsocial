import Link from "next/link";
import { FileText, Layers } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { listBrandTemplates, listMasterTemplates, type TemplateSummary } from "@/server/templates";
import { findPlaceholders } from "@/lib/templates";
import { truncate } from "@/lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";

type Chip = { name: string; color: string };

function TemplateCard({ t, brands, showBrand }: { t: TemplateSummary; brands: Map<string, Chip>; showBrand: boolean }) {
  const brand = t.brandId ? brands.get(t.brandId) : undefined;
  const behind = t.brandId ? t.pending.length : t.copies.filter((c) => c.pending.length).length;
  const holes = findPlaceholders(t.body).length;
  return (
    <Link href={`/templates/${t.id}`} className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {!t.brandId && <Badge>Master</Badge>}
        {showBrand && brand && <Badge color={brand.color}>{brand.name}</Badge>}
        {t.postType && <Badge>{t.postType}</Badge>}
        {t.masterId && <Badge><Layers className="size-3" /> From master</Badge>}
        {behind > 0 && (
          <Badge color="#d97706">{t.brandId ? `${behind} master change${behind === 1 ? "" : "s"}` : `${behind} brand${behind === 1 ? "" : "s"} behind`}</Badge>
        )}
      </div>
      <p className="mt-1.5 text-sm font-medium">{t.name}</p>
      {t.description && <p className="mt-0.5 text-xs text-muted">{truncate(t.description, 100)}</p>}
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-lg bg-surface-2 px-2 py-1.5 text-xs text-muted">{t.body || "(empty)"}</p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <div className="flex -space-x-1">
          {t.platforms.map((p) => <span key={p} className="rounded-full ring-2 ring-surface"><PlatformIcon platform={p} size={16} /></span>)}
        </div>
        <span>{holes} placeholder{holes === 1 ? "" : "s"}</span>
        {!t.brandId && <span>· {t.copies.length} brand cop{t.copies.length === 1 ? "y" : "ies"}</span>}
      </div>
    </Link>
  );
}

export default async function TemplatesPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const chips = new Map(brands.map((b) => [b.id, { name: b.name, color: b.color }]));
  const list = scope.isMaster ? await listMasterTemplates(user.id, brands.map((b) => b.id)) : await listBrandTemplates(scope.brandIds);
  const where = scope.isMaster ? "in Master" : scope.activeBrand ? `in ${scope.activeBrand.name}` : "across all brands";

  return (
    <>
      <PageHeader
        icon={scope.isMaster ? Layers : FileText}
        title={scope.isMaster ? "Master templates" : "Post templates"}
        subtitle={`${list.length} template${list.length === 1 ? "" : "s"} ${where}${scope.isMaster ? "" : ". Master templates are available to every brand from the composer."}`}
        action={<LinkButton href="/templates/new" variant="primary">New template</LinkButton>}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={scope.isMaster ? Layers : FileText}
            title="No templates yet"
            body={scope.isMaster
              ? "Write the shape of a post once — hook, structure, placeholders, hashtags — and every brand can start from it."
              : "Switch to Master to write templates every brand can use, or add one only this brand needs."}
            action={<LinkButton href="/templates/new" variant="primary">Write a template</LinkButton>}
          />
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => <TemplateCard key={t.id} t={t} brands={chips} showBrand={!scope.activeBrand && !scope.isMaster} />)}
        </div>
      )}
    </>
  );
}
