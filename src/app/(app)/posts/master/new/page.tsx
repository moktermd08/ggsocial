import { Layers } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getMasterEditorData } from "@/server/masters";
import { masterCampaignNames } from "@/server/campaigns";
import { MasterEditor } from "@/components/master-editor";
import { PageHeader } from "@/components/ui";

export default async function NewMasterPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const { campaign } = await searchParams;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const [data, campaignOptions] = await Promise.all([getMasterEditorData(brands), masterCampaignNames(user.id)]);

  return (
    <>
      <PageHeader
        icon={Layers}
        title="New master post"
        subtitle="Write it once. Every brand gets a linked copy to adapt."
      />
      <MasterEditor
        brands={data.brands}
        media={data.media}
        platforms={data.platforms}
        timezone={data.timezone}
        canEdit
        campaignOptions={campaignOptions}
        initialCampaign={campaign}
      />
    </>
  );
}
