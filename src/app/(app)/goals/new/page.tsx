import { and, inArray, isNull } from "drizzle-orm";
import { Goal as GoalIcon, Target } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, channels } from "@/lib/db";
import { platformOrNull } from "@/lib/platforms";
import { todayIn } from "@/lib/activities/periods";
import { activitiesByCode, activityInfo, getGoalTemplates } from "@/server/goals";
import { GoalForm, type FormActivity } from "@/components/goal-form";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export default async function NewGoalPage({ searchParams }: { searchParams: Promise<{ brand?: string; template?: string }> }) {
  const user = await requireUser();
  const all = await getMyBrands(user.id);
  const scope = await getScope(all);
  const brands = all.filter((b) => can.manageBrand(b.role));
  const { brand, template } = await searchParams;

  if (brands.length === 0) {
    return (
      <>
        <PageHeader icon={GoalIcon} title="New goal" />
        <Card><EmptyState icon={Target} title="Only brand admins can set goals" body="Goals change a brand's activity plan, so they need admin access on that brand." action={<LinkButton href="/goals">Back to goals</LinkButton>} /></Card>
      </>
    );
  }

  const [templates, channelRows] = await Promise.all([
    getGoalTemplates(),
    db.select({ brandId: channels.brandId, platform: channels.platform }).from(channels)
      .where(and(inArray(channels.brandId, brands.map((b) => b.id)), isNull(channels.archivedAt))),
  ]);
  const byCode = await activitiesByCode(templates.flatMap((t) => t.drivers.map((d) => d.activityCode)));
  const activities: Record<string, FormActivity> = {};
  for (const [code, t] of byCode) activities[code] = { ...activityInfo(t), title: t.title, platforms: t.platforms };

  const defaultBrand = brands.find((b) => b.id === brand) ?? brands.find((b) => b.id === scope.activeBrand?.id) ?? brands[0];

  return (
    <>
      <PageHeader
        icon={GoalIcon}
        title="New goal"
        subtitle="Set the target; the plan works out the weekly activities, checks it is reachable, and writes it into the activity checklists."
      />
      <GoalForm
        mode="create"
        today={todayIn(defaultBrand.timezone)}
        defaultBrandId={defaultBrand.id}
        defaultTemplateId={templates.find((t) => t.id === template || t.code === template)?.id}
        activities={activities}
        templates={templates.map((t) => ({ id: t.id, metric: t.metric, name: t.name, description: t.description, drivers: t.drivers }))}
        brands={brands.map((b) => ({
          id: b.id, name: b.name, color: b.color,
          platforms: [...new Set(channelRows.filter((c) => c.brandId === b.id).map((c) => c.platform))]
            .map((p) => ({ id: p, name: platformOrNull(p)?.name ?? p }))
            .sort((x, y) => x.name.localeCompare(y.name)),
        }))}
      />
    </>
  );
}
