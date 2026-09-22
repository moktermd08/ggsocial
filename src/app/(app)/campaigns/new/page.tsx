import { Megaphone } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { CampaignEditor } from "@/components/campaign-editor";
import { PageHeader } from "@/components/ui";

export default async function NewCampaignPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const writable = brands.filter((b) => can.edit(b.role));

  const where = [
    { value: "master", label: "Master — every brand" },
    ...writable.map((b) => ({ value: b.id, label: `${b.name} only`, color: b.color })),
  ];
  const defaultWhere = scope.activeBrand && writable.some((b) => b.id === scope.activeBrand!.id)
    ? scope.activeBrand.id
    : "master";

  return (
    <>
      <PageHeader icon={Megaphone} title="New campaign" subtitle="One brief every post in the campaign works from." />
      <CampaignEditor
        where={where}
        defaultWhere={defaultWhere}
        copyBrands={writable.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
        canEdit
      />
    </>
  );
}
