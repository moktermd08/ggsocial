import Link from "next/link";
import { Bot, Gauge, Hand, ShieldAlert, Workflow, Wrench } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { RUN_STATUS_META, WORKFLOWS, WORKFLOW_BY_CODE, type StepPerformer } from "@/lib/workflows/meta";
import { relativeTime } from "@/lib/format";
import { getRecentRuns, getStepSettings } from "@/server/workflows";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AutomationSettings, StepReviewSwitch } from "@/components/review-inbox";
import { spendByBrand } from "@/server/ai-usage";

const PERFORMER: Record<StepPerformer, { label: string; icon: typeof Bot }> = {
  agent: { label: "Agent", icon: Bot },
  tool: { label: "Automatic", icon: Wrench },
  human: { label: "Person", icon: Hand },
};

export default async function WorkflowsPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const ids = inScope.map((b) => b.id);
  const [settings, runs, spend] = await Promise.all([getStepSettings(ids), getRecentRuns(ids, 30), spendByBrand(inScope)]);
  const byId = new Map(inScope.map((b) => [b.id, b]));

  return (
    <>
      <PageHeader
        icon={Workflow}
        title="Workflows"
        subtitle="How each kind of work runs from start to finish, and where a person reviews it. Every step an agent does is reviewed until the brand's owner switches that off."
      />

      <Card className="mb-5 flex items-start gap-3 p-4">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="text-sm text-text">
          Safety stops apply whatever the switches say. A run always stops for a person when the reviewer flags a risk
          (prices, refunds, legal or health matters, an apology, a complaint, a sensitive topic, a claim it cannot check) or
          scores the work under the pass mark, when the copy breaks a playbook &ldquo;must&rdquo;, when the reviewer cannot run,
          when the brand&rsquo;s daily AI budget is spent, or when a step keeps failing.
        </p>
      </Card>

      {inScope.length === 0 ? (
        <Card><EmptyState icon={Workflow} title="No brands yet" body="Add a brand to set up its workflows." /></Card>
      ) : (
        <Card className="mb-5">
          <CardHeader icon={Gauge} title="AI budget and reviewer"
            subtitle="Every agent step is read by a reviewer that scores it out of 100 and flags risks. Work that scores under the pass mark, or has a flag, stops for a person. Past the daily budget, agents stop until tomorrow. Only the owner changes these." />
          <div className="space-y-3 px-4 pb-4">
            {inScope.map((brand) => (
              <div key={brand.id}>
                <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text"><span className="size-2.5 rounded-full" style={{ background: brand.color }} />{brand.name}</p>
                <AutomationSettings brandId={brand.id} budget={brand.aiDailyBudget} threshold={brand.reviewThreshold}
                  spent={spend.get(brand.id) ?? 0} canEdit={brand.role === "owner"} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {inScope.length > 0 && WORKFLOWS.map((wf) => (
        <Card key={wf.code} className="mb-5">
          <CardHeader title={wf.name} subtitle={`${wf.summary} Started by: ${wf.startedBy}.`} />
          <div className="divide-y divide-border">
            {inScope.map((brand) => (
              <div key={brand.id} className="px-4 py-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-medium text-text">
                  <span className="size-2.5 rounded-full" style={{ background: brand.color }} />{brand.name}
                  {brand.role !== "owner" && <span className="text-xs font-normal text-muted">· only the owner can switch review off</span>}
                </p>
                <ol className="space-y-2">
                  {wf.steps.map((step, i) => {
                    const row = settings.find((s) => s.brandId === brand.id && s.workflowCode === wf.code && s.stepKey === step.key);
                    const p = PERFORMER[step.performer];
                    return (
                      <li key={step.key} className="grid gap-2 rounded-lg border border-border px-3 py-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                        <div className="flex min-w-0 gap-2.5">
                          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted">{i + 1}</span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-sm text-text">
                              {step.name}
                              <span className="flex items-center gap-1 text-[11px] text-muted"><p.icon className="size-3" />{p.label}</span>
                            </p>
                            <p className="text-xs text-muted">{step.does}</p>
                          </div>
                        </div>
                        {step.reviewable ? (
                          <StepReviewSwitch
                            brandId={brand.id} code={wf.code} stepKey={step.key}
                            review={row?.review ?? true} reason={row?.reason ?? null}
                            canTurnOff={brand.role === "owner"} canTurnOn={brand.role === "owner" || can.approve(brand.role)}
                          />
                        ) : (
                          <p className="self-center text-xs text-muted">
                            {step.performer === "human" ? "A person does this when it is needed." : "Nothing to review; safety stops still apply."}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <CardHeader title="Recent runs" subtitle="The latest work moving through these workflows, newest first." />
        {runs.length === 0 ? (
          <EmptyState icon={Workflow} title="No runs yet" body="Switch the content writer on in Agents, and its posts will move through here." />
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => {
              const brand = byId.get(r.brandId);
              const wf = WORKFLOW_BY_CODE[r.workflowCode];
              const step = wf?.steps[r.stepIndex];
              const meta = RUN_STATUS_META[r.status];
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                  <Badge color={meta.color}>{meta.label}</Badge>
                  {brand && <span className="flex items-center gap-1 text-xs text-muted"><span className="size-2 rounded-full" style={{ background: brand.color }} />{brand.name}</span>}
                  <span className="text-xs text-muted">{wf?.name}{step && !["done", "cancelled"].includes(r.status) ? ` · at ${step.name}` : ""}</span>
                  <span className="min-w-0 flex-1 truncate text-text">
                    {r.subjectType === "post" && r.subjectId ? <Link href={`/posts/${r.subjectId}`} className="hover:underline">{r.summary}</Link> : r.summary}
                  </span>
                  <span className="text-xs text-muted">{relativeTime(r.updatedAt)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
