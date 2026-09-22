import { Link2 } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { DestinationEditor } from "@/components/destination-editor";
import { PageHeader } from "@/components/ui";

export default async function NewDestinationPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const writable = brands.filter((b) => can.edit(b.role));
  const defaultWhere = scope.activeBrand && writable.some((b) => b.id === scope.activeBrand!.id) ? scope.activeBrand.id : "master";

  return (
    <>
      <PageHeader icon={Link2} title="New destination" subtitle="Somewhere your links send people, saved once." />
      <DestinationEditor
        where={[
          { value: "master", label: "Master — every brand" },
          ...writable.map((b) => ({ value: b.id, label: `${b.name} only`, color: b.color })),
        ]}
        defaultWhere={defaultWhere}
        copyBrands={writable.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
        canEdit
      />
    </>
  );
}
