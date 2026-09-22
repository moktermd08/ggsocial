import { Lightbulb } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getIdeaBoard } from "@/server/queries";
import { IdeaBoard } from "@/components/idea-board";
import { PageHeader } from "@/components/ui";

export default async function IdeasPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const rows = await getIdeaBoard(user.id, scope.brandIds, brands.map((b) => b.id));

  const shipped = rows.filter((r) => r.lanes.some((l) => l.post?.status === "published")).length;
  const laneCount = rows[0]?.lanes.length ?? scope.brandIds.length;

  return (
    <>
      <PageHeader
        icon={Lightbulb}
        title={scope.activeBrand ? `Content plan · ${scope.activeBrand.name}` : "Content plan"}
        subtitle={
          rows.length === 0
            ? "One idea, told once per brand."
            : `${rows.length} ideas · ${laneCount} lane${laneCount === 1 ? "" : "s"} each · ${shipped} shipped`
        }
      />

      <IdeaBoard
        rows={rows}
        scopeLabel={scope.activeBrand?.name ?? null}
        brandScope={scope.activeBrand ? { id: scope.activeBrand.id, name: scope.activeBrand.name } : null}
      />
    </>
  );
}
