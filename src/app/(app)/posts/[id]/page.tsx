import { notFound } from "next/navigation";
import { Copy, Layers } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getPost, getPostLinks } from "@/server/queries";
import { getComposerData } from "@/server/composer-data";
import { Composer } from "@/components/composer";
import { ReviewPanel } from "@/components/review-panel";
import { TargetStatusList } from "@/components/target-status-list";
import { PlanPanel } from "@/components/plan-panel";
import { LinkPanel } from "@/components/link-panel";
import { PageHeader, Badge, buttonClass } from "@/components/ui";
import { STATUS_META, inZone } from "@/lib/format";
import { duplicatePostAction } from "@/server/actions/posts";
import { promoteToMasterAction, resolveCopyFieldAction, unlinkCopyAction } from "@/server/actions/masters";
import { getCopyContext } from "@/server/masters";
import { findBrandCampaign } from "@/server/campaigns";
import { CampaignBriefCard } from "@/components/campaign-panels";
import { FromMasterPanel, MasterComments } from "@/components/master-panels";
import { MASTER_FIELDS, MASTER_FIELD_LABELS, type MasterField } from "@/lib/masters";
import { appOrigin } from "@/lib/links";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const post = await getPost(id);
  if (!post) notFound();

  const membership = brands.find((b) => b.id === post.brandId);
  if (!membership) notFound();

  const data = await getComposerData(brands.filter((b) => b.id === post.brandId));
  const postLinks = await getPostLinks(post.id);
  const meta = STATUS_META[post.status];
  const editable = can.edit(membership.role) && post.status !== "published";
  const [copy, campaign] = await Promise.all([
    getCopyContext(post, post.media.map((m) => m.id)),
    findBrandCampaign(post.brandId, post.campaign),
  ]);

  // A copy can carry media from another brand's library (picked on the
  // master), so make sure the composer can show what is attached.
  const library = data.mediaByBrand[post.brandId] ?? [];
  const extra = [...post.media, ...(copy?.master.media ?? [])]
    .filter((m, i, all) => !library.some((l) => l.id === m.id) && all.findIndex((x) => x.id === m.id) === i)
    .map((m) => ({ id: m.id, url: m.url, kind: m.kind, originalName: m.originalName }));
  data.mediaByBrand[post.brandId] = [...extra, ...library];

  const readable: Partial<Record<MasterField, string>> = {};
  if (copy) {
    for (const f of MASTER_FIELDS) {
      const v = copy.values[f];
      readable[f] = f === "tags" ? (JSON.parse(v) as string[]).join(", ")
        : f === "media" ? `${(JSON.parse(v) as string[]).length} file(s)`
        : f === "scheduledAt" ? (v ? `${inZone(v, post.brand.timezone)} ${post.brand.timezone}` : "No date")
        : v;
    }
  }

  const sidebar = (
    <>
      {copy && (
        <>
          <FromMasterPanel
            href={`/posts/master/${copy.master.id}`}
            masterTitle={copy.master.title}
            guidelines={copy.master.guidelines}
            notes={copy.master.notes}
            pending={copy.state.pending}
            customised={copy.state.customised}
            masterValues={readable}
            canEdit={can.edit(membership.role)}
            fieldLabels={MASTER_FIELD_LABELS}
            resolve={resolveCopyFieldAction.bind(null, post.id)}
            unlink={unlinkCopyAction.bind(null, post.id)}
            unlinkConfirm="Stop following the master? This post keeps its current content."
          />
          <MasterComments
            masterId={copy.master.id}
            comments={copy.master.comments.map((c) => ({
              id: c.id, body: c.body, author: c.author, createdAt: c.createdAt.toISOString(),
            }))}
          />
        </>
      )}
      {campaign && <CampaignBriefCard campaign={campaign} />}
      <TargetStatusList
        canPublish={can.publish(membership.role)}
        targets={post.targets.map((t) => ({
          id: t.id,
          platform: t.channel.platform,
          handle: t.channel.handle,
          mode: t.channel.mode,
          status: t.status,
          externalUrl: t.externalUrl,
          lastError: t.lastError,
          attempts: t.attempts,
        }))}
      />
      <LinkPanel
        brandId={post.brandId}
        postId={post.id}
        campaign={post.campaign}
        canEdit={can.edit(membership.role)}
        channels={post.targets.map((t) => ({ id: t.channelId, platform: t.channel.platform, handle: t.channel.handle }))}
        existing={postLinks.map((l) => ({
          id: l.link.id,
          code: l.link.code,
          url: `${appOrigin()}/l/${l.link.code}`,
          label: l.link.label,
          destination: l.link.destination,
          platform: l.channel?.platform ?? null,
          handle: l.channel?.handle ?? null,
          clickCount: l.link.clickCount,
          uniqueCount: l.link.uniqueCount,
        }))}
      />
      <PlanPanel
        canEdit={can.edit(membership.role)}
        post={{
          id: post.id,
          targetImpressions: post.targetImpressions,
          keyLearning: post.keyLearning,
          notes: post.notes,
          repliedAt: post.repliedAt?.toISOString() ?? null,
          publishedAt: post.publishedAt?.toISOString() ?? null,
          timezone: post.brand.timezone,
        }}
        idea={post.idea && {
          id: post.idea.id,
          sequence: post.idea.sequence,
          problem: post.idea.problem,
          pillar: post.idea.pillar,
          title: post.idea.title,
        }}
      />
      <ReviewPanel
        postId={post.id}
        status={post.status}
        canApprove={can.approve(membership.role)}
        canEdit={can.edit(membership.role)}
        comments={post.comments.map((c) => ({
          id: c.id, body: c.body, kind: c.kind,
          createdAt: c.createdAt.toISOString(), author: c.user?.name ?? "Someone",
        }))}
      />
    </>
  );

  return (
    <>
      <PageHeader
        title={post.title || "Untitled post"}
        subtitle={`${post.brand.name} · ${post.scheduledAt ? inZone(post.scheduledAt, post.brand.timezone) + " " + post.brand.timezone : "no date set"}`}
        action={
          <div className="flex items-center gap-2">
            <Badge color={meta.color}>{meta.label}</Badge>
            {!post.masterPostId && can.edit(membership.role) && (
              <form action={promoteToMasterAction.bind(null, post.id)}>
                <button className={buttonClass("subtle", "sm")} title="Make this the master copy, then carry it into other brands">
                  <Layers className="size-3.5" /> Make master
                </button>
              </form>
            )}
            <form action={duplicatePostAction.bind(null, post.id)}>
              <button className={buttonClass("subtle", "sm")}><Copy className="size-3.5" /> Duplicate</button>
            </form>
          </div>
        }
      />

      {editable ? (
        <Composer
          // Remount when the saved post changes underneath (a master change
          // taken from the side panel), so the editor shows it.
          key={post.updatedAt.toISOString()}
          brands={data.composerBrands}
          channelsByBrand={data.channelsByBrand}
          mediaByBrand={data.mediaByBrand}
          campaignsByBrand={data.campaignsByBrand}
          platforms={data.platforms}
          initialBrandId={post.brandId}
          canApprove={can.approve(membership.role)}
          sidebarExtras={sidebar}
          master={copy?.values}
          post={{
            id: post.id,
            ideaId: post.ideaId,
            title: post.title,
            body: post.body,
            scheduledAt: post.scheduledAt?.toISOString() ?? null,
            campaign: post.campaign,
            mediaIds: post.media.map((m) => m.id),
            targets: post.targets.map((t) => ({
              channelId: t.channelId,
              bodyOverride: t.bodyOverride,
              firstComment: t.firstComment,
              options: (t.options ?? {}) as Record<string, unknown>,
              status: t.status,
            })),
          }}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <article className="rounded-xl border border-border bg-surface p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.body}</p>
              {post.media.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {post.media.map((m) =>
                    m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={m.id} src={m.url} alt={m.altText ?? ""} className="size-24 rounded-lg object-cover" />
                    ) : (
                      <span key={m.id} className="grid size-24 place-items-center rounded-lg bg-surface-2 p-1 text-center text-[10px]">
                        {m.originalName}
                      </span>
                    ),
                  )}
                </div>
              )}
            </article>
            <p className="text-xs text-muted">
              {post.status === "published"
                ? "Published posts are read-only here. Duplicate it to reuse the copy."
                : "You have view-only access to this brand."}
            </p>
          </div>
          <div className="space-y-5">{sidebar}</div>
        </div>
      )}
    </>
  );
}
