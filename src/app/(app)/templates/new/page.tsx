import { FileText } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getMasterEditorData } from "@/server/masters";
import { TemplateEditor } from "@/components/template-editor";
import { PageHeader } from "@/components/ui";

export default async function NewTemplatePage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const writable = brands.filter((b) => can.edit(b.role));
  const { platforms } = await getMasterEditorData(brands);
  const defaultWhere = scope.activeBrand && writable.some((b) => b.id === scope.activeBrand!.id) ? scope.activeBrand.id : "master";

  return (
    <>
      <PageHeader icon={FileText} title="New template" subtitle="The shape of a post, ready to fill in." />
      <TemplateEditor
        where={[
          { value: "master", label: "Master — every brand" },
          ...writable.map((b) => ({ value: b.id, label: `${b.name} only`, color: b.color })),
        ]}
        defaultWhere={defaultWhere}
        copyBrands={writable.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
        platforms={platforms}
        canEdit
      />
    </>
  );
}
