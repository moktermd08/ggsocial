import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getEngagementQueue, getEngagementCounts, getBrandChannels } from "@/server/queries";
import { EngagementQueue, type QueueBrand } from "@/components/engagement-queue";
import { Card, PageHeader } from "@/components/ui";

export default async function EngagePage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);

  const [items, counts, channels] = await Promise.all([
    getEngagementQueue({ brandIds: scope.brandIds, limit: 300 }),
    getEngagementCounts(scope.brandIds),
    getBrandChannels(scope.brandIds),
  ]);

  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const queueBrands: QueueBrand[] = inScope.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    replySlaMinutes: b.replySlaMinutes,
    channels: channels.filter((c) => c.brandId === b.id).map((c) => ({ id: c.id, platform: c.platform, handle: c.handle })),
  }));

  const canEdit = inScope.some((b) => can.edit(b.role));

  const tiles = [
    { label: "Open", value: counts.open, tone: "text-text" },
    { label: "Late", value: counts.overdue, tone: counts.overdue > 0 ? "text-danger" : "text-text" },
    { label: "Due today", value: counts.dueToday, tone: "text-text" },
    { label: "Replied today", value: counts.repliedToday, tone: "text-ok" },
  ];

  return (
    <>
      <PageHeader
        title="Engagement"
        subtitle="Every comment, message, review and outreach task across your brands, worst first."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="px-4 py-3">
            <p className="text-xs text-muted">{t.label}</p>
            <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
          </Card>
        ))}
      </div>

      <EngagementQueue
        items={items.map((i) => ({
          id: i.interaction.id,
          brandId: i.brand.id,
          brandName: i.brand.name,
          brandColor: i.brand.color,
          platform: i.channel?.platform ?? null,
          handle: i.channel?.handle ?? null,
          post: i.post,
          kind: i.interaction.kind,
          direction: i.interaction.direction,
          status: i.interaction.status,
          priority: i.interaction.priority,
          authorName: i.interaction.authorName,
          authorHandle: i.interaction.authorHandle,
          authorUrl: i.interaction.authorUrl,
          authorReach: i.interaction.authorReach,
          body: i.interaction.body,
          externalUrl: i.interaction.externalUrl,
          replyBody: i.interaction.replyBody,
          receivedAt: i.interaction.receivedAt.toISOString(),
          dueAt: i.interaction.dueAt?.toISOString() ?? null,
          repliedAt: i.interaction.repliedAt?.toISOString() ?? null,
          assigneeName: i.assignee?.name ?? null,
        }))}
        brands={queueBrands}
        canEdit={canEdit}
        now={counts.now}
      />
    </>
  );
}
