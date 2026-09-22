import { Layers, Megaphone } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { listBrandCampaigns, listMasterCampaigns } from "@/server/campaigns";
import { CampaignCard } from "@/components/campaign-card";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default async function CampaignsPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const chips = new Map(brands.map((b) => [b.id, { id: b.id, name: b.name, color: b.color }]));

  const list = scope.isMaster
    ? await listMasterCampaigns(user.id, brands.map((b) => b.id))
    : await listBrandCampaigns(scope.brandIds);

  const where = scope.isMaster ? "in Master" : scope.activeBrand ? `in ${scope.activeBrand.name}` : "across all brands";
  const active = list.filter((c) => c.status !== "done");
  const done = list.filter((c) => c.status === "done");

  return (
    <>
      <PageHeader
        icon={scope.isMaster ? Layers : Megaphone}
        title={scope.isMaster ? "Master campaigns" : "Campaigns"}
        subtitle={`${list.length} campaign${list.length === 1 ? "" : "s"} ${where}`}
        action={<LinkButton href="/campaigns/new" variant="primary">New campaign</LinkButton>}
      />

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={scope.isMaster ? Layers : Megaphone}
            title="No campaigns yet"
            body={scope.isMaster
              ? "Write the brief once here — objective, key message, CTA, dates, targets — and every brand gets a linked copy to run."
              : "A campaign holds the brief every post in it works from. Switch to Master to write one for all brands at once."}
            action={<LinkButton href="/campaigns/new" variant="primary">Plan a campaign</LinkButton>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {active.map((c) => <CampaignCard key={c.id} campaign={c} brands={chips} showBrand={!scope.activeBrand && !scope.isMaster} />)}
          </div>
          {done.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Done</h2>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {done.map((c) => <CampaignCard key={c.id} campaign={c} brands={chips} showBrand={!scope.activeBrand && !scope.isMaster} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
