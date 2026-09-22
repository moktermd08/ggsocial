import { notFound } from "next/navigation";
import { FileText, Layers } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getTemplate, templateAccess } from "@/server/templates";
import { getMasterEditorData } from "@/server/masters";
import {
  addTemplateCopiesAction, resolveTemplateFieldAction, unlinkTemplateAction,
} from "@/server/actions/templates";
import {
  TEMPLATE_FIELDS, TEMPLATE_FIELD_LABELS, readableTemplateValue, templateValues, type TemplateField,
} from "@/lib/templates";
import { TemplateEditor } from "@/components/template-editor";
import { FromMasterPanel, LinkedCopiesPanel } from "@/components/master-panels";
import { PageHeader } from "@/components/ui";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const t = await getTemplate(id);
  if (!t) notFound();
  const access = await templateAccess(t, user.id, brands);
  if (!access.canView) notFound();

  const { platforms } = await getMasterEditorData(brands);
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const brand = t.brandId ? brandById.get(t.brandId) : undefined;
  const masterValues = t.master ? templateValues(t.master) : undefined;
  const readable: Partial<Record<TemplateField, string>> = {};
  if (masterValues) for (const f of TEMPLATE_FIELDS) readable[f] = readableTemplateValue(f, masterValues[f]);
  const copyBrands = new Set(t.copies.map((c) => c.brandId));

  return (
    <>
      <PageHeader
        icon={t.brandId ? FileText : Layers}
        title={t.name}
        subtitle={t.brandId ? `${brand?.name ?? "Brand"} template${t.master ? " · from master" : ""}` : "Master template · available to every brand"}
      />
      <TemplateEditor
        key={t.updatedAt.toISOString()}
        template={{ id: t.id, brandId: t.brandId, values: templateValues(t), notes: t.notes }}
        master={masterValues}
        platforms={platforms}
        canEdit={access.canEdit}
        sidebar={
          <>
            {t.master && t.state && (
              <FromMasterPanel
                href={`/templates/${t.master.id}`}
                masterTitle={t.master.name}
                guidelines={t.master.description}
                notes={t.master.notes}
                pending={t.state.pending}
                customised={t.state.customised}
                masterValues={readable}
                fieldLabels={TEMPLATE_FIELD_LABELS}
                canEdit={access.canEdit}
                resolve={resolveTemplateFieldAction.bind(null, t.id)}
                unlink={unlinkTemplateAction.bind(null, t.id)}
                unlinkConfirm="Stop following the master template? This brand keeps its current version."
              />
            )}
            {!t.brandId && (
              <LinkedCopiesPanel
                fieldLabels={TEMPLATE_FIELD_LABELS}
                copies={t.copies.map((c) => {
                  const b = brandById.get(c.brandId);
                  return {
                    id: c.id, href: `/templates/${c.id}`, brandName: b?.name ?? "Another brand", brandColor: b?.color ?? "#888",
                    customised: c.customised, pending: c.pending,
                  };
                })}
                addable={brands.filter((b) => can.edit(b.role) && !copyBrands.has(b.id)).map((b) => ({ id: b.id, name: b.name, color: b.color }))}
                add={addTemplateCopiesAction.bind(null, t.id)}
              />
            )}
          </>
        }
      />
    </>
  );
}
