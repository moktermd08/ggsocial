import { notFound } from "next/navigation";
import { Layers } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getMaster, getMasterEditorData, masterAccess } from "@/server/masters";
import { isLockedStatus } from "@/lib/masters";
import { MasterEditor } from "@/components/master-editor";
import { MasterComments, MasterCopiesPanel } from "@/components/master-panels";
import { Badge, PageHeader } from "@/components/ui";

export default async function MasterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const master = await getMaster(id);
  if (!master) notFound();

  const access = masterAccess(master, master.copies.map((c) => c.brandId), user.id, brands);
  if (!access.canView) notFound();

  const data = await getMasterEditorData(brands);
  // Media already on the master stays visible even when it came from a brand
  // this person is not on.
  const media = [
    ...master.media.filter((m) => !data.media.some((d) => d.id === m.id)).map((m) => ({
      id: m.id, url: m.url, kind: m.kind, originalName: m.originalName, brandColor: "#888", brandName: "",
    })),
    ...data.media,
  ];
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const copyBrands = new Set(master.copies.map((c) => c.brandId));
  const waiting = master.copies.reduce((n, c) => n + c.pending.length, 0);

  return (
    <>
      <PageHeader
        icon={Layers}
        title={master.title || "Untitled master"}
        subtitle={`Master · in ${master.copies.length} brand${master.copies.length === 1 ? "" : "s"}`}
        action={waiting > 0 ? <Badge color="#d97706">{waiting} change{waiting === 1 ? "" : "s"} waiting in brands</Badge> : undefined}
      />
      <MasterEditor
        master={{
          id: master.id, title: master.title, body: master.body, campaign: master.campaign, tags: master.tags,
          scheduledAt: master.scheduledAt?.toISOString() ?? null, mediaIds: master.mediaIds,
          platforms: master.platforms, guidelines: master.guidelines, notes: master.notes,
        }}
        brands={data.brands}
        media={media}
        platforms={data.platforms}
        timezone={data.timezone}
        canEdit={access.canEdit}
        sidebar={
          <>
            <MasterCopiesPanel
              masterId={master.id}
              copies={master.copies.map((c) => {
                const b = brandById.get(c.brandId);
                return {
                  postId: c.postId, brandId: c.brandId, status: c.status,
                  brandName: b?.name ?? "Another brand", brandColor: b?.color ?? "#888",
                  customised: c.customised, pending: c.pending,
                  canEdit: b ? can.edit(b.role) : false, locked: isLockedStatus(c.status),
                };
              })}
              addable={brands.filter((b) => can.edit(b.role) && !copyBrands.has(b.id))
                .map((b) => ({ id: b.id, name: b.name, color: b.color }))}
            />
            <MasterComments
              masterId={master.id}
              comments={master.comments.map((c) => ({
                id: c.id, body: c.body, author: c.author, createdAt: c.createdAt.toISOString(),
              }))}
            />
          </>
        }
      />
    </>
  );
}
