import { Building2 } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getAttention } from "@/server/attention";
import { headline } from "@/lib/attention";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AutopilotCard, BrandBoard, ComingUpCard, GoalsCard, Headline, NeedsYou } from "@/components/dashboard";

/**
 * The manager's morning screen. It answers four questions in order: what needs
 * me, what is going out, how is each brand doing, and what did the agents do
 * without me. Anything that does not need a person stays out of the first one.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);

  if (brands.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Building2}
          title="Add your first brand"
          body="Each company or project you manage gets its own brand: its own channels, media library, calendar and team. Add them one at a time, or all ten now."
          action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>}
        />
      </Card>
    );
  }

  const scope = await getScope(brands);
  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const data = await getAttention(inScope);
  const brandMap = new Map(brands.map((b) => [b.id, b]));
  const showBrand = !scope.activeBrand;
  const tz = scope.activeBrand?.timezone ?? inScope[0]?.timezone ?? "UTC";

  const nowCount = data.items.filter((i) => i.severity === "now").length;
  const todayCount = data.items.filter((i) => i.severity === "today").length;
  const wrong = data.items.filter((i) => i.kind === "channel" || i.kind === "post_failed" || i.kind === "agent").length;
  const h = headline({ now: nowCount, today: todayCount, wrong });
  const channelCount = data.brands.reduce((n, b) => n + b.channels.length, 0);

  return (
    <>
      <PageHeader
        title={scope.activeBrand ? scope.activeBrand.name : "Today"}
        subtitle={`${inScope.length} brand${inScope.length === 1 ? "" : "s"} · ${channelCount} channel${channelCount === 1 ? "" : "s"}`}
        action={<LinkButton href="/posts/new" variant="primary">New post</LinkButton>}
      />
      <Headline text={h.text} tone={h.tone} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <NeedsYou items={data.items} brands={brandMap} now={data.now} showBrand={showBrand} next={data.coming[0] ?? null} />
          <ComingUpCard rows={data.coming} brands={brandMap} tz={tz} showBrand={showBrand} />
          <AutopilotCard a={data.autopilot} brands={brandMap} now={data.now} showBrand={showBrand} />
        </div>
        <div className="min-w-0 space-y-5">
          <BrandBoard rows={data.brands} now={data.now} />
          <GoalsCard goals={data.goals} brands={brandMap} showBrand={showBrand} />
        </div>
      </div>
    </>
  );
}
