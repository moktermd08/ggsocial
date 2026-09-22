import { notFound } from "next/navigation";
import { Layers, Link2, MousePointerClick } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { destinationAccess, getDestination } from "@/server/destinations";
import {
  addDestinationCopiesAction, resolveDestinationFieldAction, unlinkDestinationAction,
} from "@/server/actions/destinations";
import { DEST_FIELDS, DEST_FIELD_LABELS, destValues, type DestField } from "@/lib/destinations";
import { DestinationEditor } from "@/components/destination-editor";
import { FromMasterPanel, LinkedCopiesPanel } from "@/components/master-panels";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function DestinationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const d = await getDestination(id, brands.map((b) => b.id));
  if (!d) notFound();
  const access = await destinationAccess(d, user.id, brands);
  if (!access.canView) notFound();

  const brandById = new Map(brands.map((b) => [b.id, b]));
  const brand = d.brandId ? brandById.get(d.brandId) : undefined;
  const masterValues = d.master ? destValues(d.master) : undefined;
  const readable: Partial<Record<DestField, string>> = {};
  if (masterValues) for (const f of DEST_FIELDS) readable[f] = masterValues[f];
  const copyBrands = new Set(d.copies.map((c) => c.brandId));

  return (
    <>
      <PageHeader
        icon={d.brandId ? Link2 : Layers}
        title={d.name}
        subtitle={d.brandId ? `${brand?.name ?? "Brand"} destination${d.master ? " · from master" : ""}` : "Master destination · every brand can issue links from it"}
      />
      <DestinationEditor
        key={d.updatedAt.toISOString()}
        destination={{ id: d.id, brandId: d.brandId, values: destValues(d), notes: d.notes }}
        master={masterValues}
        canEdit={access.canEdit}
        sidebar={
          <>
            <Card>
              <CardHeader icon={MousePointerClick} title="Traffic" subtitle={d.brandId ? "Links issued from this destination" : "Across every brand"} />
              <dl className="grid grid-cols-3 gap-2 p-3 text-center">
                {[["Links", d.links], ["Clicks", d.clicks], ["People", d.uniques]].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-surface-2 py-2">
                    <dd className="text-lg font-semibold tabular-nums">{(v as number).toLocaleString()}</dd>
                    <dt className="text-[11px] text-muted">{k}</dt>
                  </div>
                ))}
              </dl>
            </Card>
            {d.master && d.state && (
              <FromMasterPanel
                href={`/links/destinations/${d.master.id}`}
                masterTitle={d.master.name}
                guidelines={null}
                notes={d.master.notes}
                pending={d.state.pending}
                customised={d.state.customised}
                masterValues={readable}
                fieldLabels={DEST_FIELD_LABELS}
                canEdit={access.canEdit}
                resolve={resolveDestinationFieldAction.bind(null, d.id)}
                unlink={unlinkDestinationAction.bind(null, d.id)}
                unlinkConfirm="Stop following the master destination? This brand keeps its current URL."
              />
            )}
            {!d.brandId && (
              <LinkedCopiesPanel
                fieldLabels={DEST_FIELD_LABELS}
                copies={d.copies.map((c) => {
                  const b = brandById.get(c.brandId);
                  return {
                    id: c.id, href: `/links/destinations/${c.id}`, brandName: b?.name ?? "Another brand", brandColor: b?.color ?? "#888",
                    customised: c.customised, pending: c.pending,
                  };
                })}
                addable={brands.filter((b) => can.edit(b.role) && !copyBrands.has(b.id)).map((b) => ({ id: b.id, name: b.name, color: b.color }))}
                add={addDestinationCopiesAction.bind(null, d.id)}
              />
            )}
          </>
        }
      />
    </>
  );
}
