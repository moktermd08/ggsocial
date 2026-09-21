import { ListChecks, PartyPopper } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getPublishQueue } from "@/server/queries";
import { getPlatform } from "@/lib/platforms";
import { publicUrl } from "@/server/media";
import { QueueCard, type QueueItem } from "@/components/queue-card";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { inZone, truncate } from "@/lib/format";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { filter } = await searchParams;

  const rows = await getPublishQueue(scope.brandIds);
  const roleByBrand = new Map(brands.map((b) => [b.id, b.role]));

  const items: QueueItem[] = rows
    .filter((r) => (filter === "failed" ? r.target.status === "failed" : r.target.status !== "scheduled" || filter === "all"))
    .map((r) => {
      const platform = getPlatform(r.channel.platform);
      const body = r.target.bodyOverride ?? r.post.body;
      const options = (r.target.options ?? {}) as Record<string, unknown>;
      const steps = platform.manualSteps?.({
        brand: r.brand, channel: r.channel, post: r.post, target: r.target,
        body, firstComment: r.target.firstComment, media: r.media, options,
        publicUrl: (m) => publicUrl(m.url), credentials: null,
      }) ?? [];

      return {
        targetId: r.target.id,
        postId: r.post.id,
        title: r.post.title || truncate(r.post.body, 50) || "Untitled",
        brandName: r.brand.name,
        brandColor: r.brand.color,
        platform: r.channel.platform,
        handle: r.channel.handle,
        mode: r.channel.mode,
        status: r.target.status,
        scheduledLabel: r.target.scheduledAt ? `${inZone(r.target.scheduledAt, r.brand.timezone)} ${r.brand.timezone}` : "no time set",
        body,
        firstComment: r.target.firstComment,
        lastError: r.target.lastError,
        steps,
        media: r.media.map((m) => ({ id: m.id, url: m.url, kind: m.kind, originalName: m.originalName })),
        canPublish: can.publish(roleByBrand.get(r.post.brandId) ?? "viewer"),
      };
    });

  return (
    <>
      <PageHeader
        icon={ListChecks}
        title="Publish queue"
        subtitle="Everything due on a manual channel, plus anything that failed. Copy, post, tick off."
        action={<LinkButton href={filter === "all" ? "/queue" : "/queue?filter=all"} size="sm">
          {filter === "all" ? "Hide scheduled" : "Show scheduled too"}
        </LinkButton>}
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={PartyPopper}
            title="Queue is clear"
            body="Nothing is waiting on a human right now. Scheduled posts on live channels go out on their own."
            action={<LinkButton href="/calendar" variant="primary">Open calendar</LinkButton>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => <QueueCard key={item.targetId} item={item} />)}
        </div>
      )}
    </>
  );
}
