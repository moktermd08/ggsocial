import { PenSquare, Lock } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getComposerData } from "@/server/composer-data";
import { Composer } from "@/components/composer";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ date?: string; brand?: string; campaign?: string }> }) {
  const user = await requireUser();
  const all = await getMyBrands(user.id);
  const writable = all.filter((b) => can.edit(b.role));
  const { date, brand, campaign } = await searchParams;

  if (writable.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="No brand to write for"
          body="You need editor access on at least one brand before you can create content."
          action={<LinkButton href="/brands" variant="primary">Brands</LinkButton>}
        />
      </Card>
    );
  }

  const scope = await getScope(writable);
  const data = await getComposerData(writable);
  const initialBrandId = brand ?? scope.activeBrand?.id ?? writable[0].id;

  return (
    <>
      <PageHeader icon={PenSquare} title="New post" subtitle="One draft, every channel that should carry it." />
      <Composer
        brands={data.composerBrands}
        channelsByBrand={data.channelsByBrand}
        mediaByBrand={data.mediaByBrand}
        campaignsByBrand={data.campaignsByBrand}
        initialCampaign={campaign}
        platforms={data.platforms}
        initialBrandId={initialBrandId}
        initialDate={date}
        canApprove={can.approve(writable.find((b) => b.id === initialBrandId)?.role ?? "viewer")}
      />
    </>
  );
}
