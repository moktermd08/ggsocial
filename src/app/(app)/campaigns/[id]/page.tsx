import { notFound } from "next/navigation";
import { Layers, Megaphone } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { campaignAccess, getCampaign } from "@/server/campaigns";
import {
  addCampaignCommentAction, resolveCampaignFieldAction, unlinkCampaignAction,
} from "@/server/actions/campaigns";
import {
  CAMPAIGN_FIELDS, CAMPAIGN_FIELD_LABELS, campaignValues, readableCampaignValue, type CampaignField,
} from "@/lib/campaigns";
import { inZone } from "@/lib/format";
import { CampaignEditor } from "@/components/campaign-editor";
import { CampaignCopiesPanel, CampaignPostsPanel } from "@/components/campaign-panels";
import { FromMasterPanel, MasterComments } from "@/components/master-panels";
import { Badge, PageHeader } from "@/components/ui";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const c = await getCampaign(id);
  if (!c) notFound();
  const access = await campaignAccess(c, user.id, brands);
  if (!access.canView) notFound();

  const brandById = new Map(brands.map((b) => [b.id, b]));
  const brand = c.brandId ? brandById.get(c.brandId) : undefined;
  const masterValues = c.master ? campaignValues(c.master) : undefined;

  const readable: Partial<Record<CampaignField, string>> = {};
  if (masterValues) for (const f of CAMPAIGN_FIELDS) readable[f] = readableCampaignValue(f, masterValues[f]);

  const copyBrands = new Set(c.copies.map((x) => x.brandId));
  const toRows = (rows: typeof c.comments) =>
    rows.map((x) => ({ id: x.id, body: x.body, author: x.author, createdAt: x.createdAt.toISOString() }));

  const newPostHref = c.brandId
    ? `/posts/new?brand=${c.brandId}&campaign=${encodeURIComponent(c.name)}`
    : `/posts/master/new?campaign=${encodeURIComponent(c.name)}`;

  const sidebar = (
    <>
      {c.master && c.state && masterValues && (
        <>
          <FromMasterPanel
            href={`/campaigns/${c.master.id}`}
            masterTitle={c.master.name}
            guidelines={c.master.guidelines}
            notes={c.master.notes}
            pending={c.state.pending}
            customised={c.state.customised}
            masterValues={readable}
            fieldLabels={CAMPAIGN_FIELD_LABELS}
            canEdit={access.canEdit}
            resolve={resolveCampaignFieldAction.bind(null, c.id)}
            unlink={unlinkCampaignAction.bind(null, c.id)}
            unlinkConfirm="Stop following the master campaign? This brand keeps its current brief."
          />
          <MasterComments
            title="Master comments"
            comments={toRows(c.masterComments)}
            add={addCampaignCommentAction.bind(null, c.master.id)}
          />
        </>
      )}
      {!c.brandId && (
        <CampaignCopiesPanel
          campaignId={c.id}
          copies={c.copies.map((x) => {
            const b = brandById.get(x.brandId);
            return {
              id: x.id, brandName: b?.name ?? "Another brand", brandColor: b?.color ?? "#888", status: x.status,
              customised: x.customised, pending: x.pending, posts: x.posts, published: x.published,
            };
          })}
          addable={brands.filter((b) => can.edit(b.role) && !copyBrands.has(b.id)).map((b) => ({ id: b.id, name: b.name, color: b.color }))}
        />
      )}
      <CampaignPostsPanel
        newHref={access.canEdit ? newPostHref : undefined}
        masterPosts={c.brandId ? undefined : c.masterPosts}
        posts={c.posts.map((p) => {
          const b = brandById.get(p.brandId);
          return {
            id: p.id, title: p.title, body: p.body, status: p.status, fromMaster: Boolean(p.masterPostId),
            when: p.scheduledAt ? inZone(p.scheduledAt, b?.timezone ?? "UTC") : null,
            ...(c.brandId ? {} : { brandName: b?.name, brandColor: b?.color }),
          };
        })}
      />
      <MasterComments
        title={c.brandId ? (c.master ? `${brand?.name ?? "Brand"} comments` : "Comments") : "Comments"}
        comments={toRows(c.comments)}
        add={addCampaignCommentAction.bind(null, c.id)}
        placeholder={c.brandId ? "Comment on this brand's campaign…" : "Comment for every brand…"}
        emptyHint={c.brandId ? "For this brand's team" : "Seen from every brand's copy"}
      />
    </>
  );

  return (
    <>
      <PageHeader
        icon={c.brandId ? Megaphone : Layers}
        title={c.name}
        subtitle={c.brandId
          ? `${brand?.name ?? "Brand"} campaign${c.master ? " · from master" : ""}`
          : `Master campaign · in ${c.copies.length} brand${c.copies.length === 1 ? "" : "s"}`}
        action={c.pending.length > 0 ? <Badge color="#d97706">{c.pending.length} master change{c.pending.length === 1 ? "" : "s"} waiting</Badge> : undefined}
      />
      <CampaignEditor
        key={c.updatedAt.toISOString()}
        campaign={{
          id: c.id, brandId: c.brandId, values: campaignValues(c), status: c.status,
          guidelines: c.guidelines, notes: c.notes,
        }}
        master={masterValues}
        canEdit={access.canEdit}
        sidebar={sidebar}
      />
    </>
  );
}
