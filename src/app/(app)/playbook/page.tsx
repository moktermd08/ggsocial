import Link from "next/link";
import { BookCheck, History, Inbox, ScrollText } from "lucide-react";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { PLATFORM_LIST } from "@/lib/platforms";
import { PageHeader } from "@/components/ui";
import { PlaybookRules, PlaybookReview, type AdjustmentView } from "@/components/playbook";
import {
  brandAdjustRights, canEditMaster, getBrandPlaybooks, getPlaybookRules, listAdjustments,
} from "@/server/playbook";

type View = "rules" | "review" | "history";
const VIEWS: { id: View; label: string; icon: typeof ScrollText }[] = [
  { id: "rules", label: "Rules", icon: ScrollText },
  { id: "review", label: "Daily review", icon: Inbox },
  { id: "history", label: "Change log", icon: History },
];

function href(view: View, brand?: string | null) {
  const q = new URLSearchParams({ v: view });
  if (brand) q.set("b", brand);
  return `/playbook?${q}`;
}

export default async function PlaybookPage({ searchParams }: { searchParams: Promise<{ v?: string; b?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { v, b } = await searchParams;
  const view: View = VIEWS.some((x) => x.id === v) ? (v as View) : "rules";

  const inScope = brands.filter((x) => scope.brandIds.includes(x.id));
  // "master" or a brand id; defaults to the brand picked in the switcher, else the master.
  const brandId = b === "master" ? null : inScope.find((x) => x.id === b)?.id ?? scope.activeBrand?.id ?? null;
  const master = await canEditMaster(user);

  const [rules, playbooks, adjustments] = await Promise.all([
    getPlaybookRules({ includeArchived: true }),
    getBrandPlaybooks(inScope.map((x) => x.id)),
    view === "rules" ? Promise.resolve([]) : listAdjustments({
      brandIds: inScope.map((x) => x.id), includeMaster: true,
      status: view === "review" ? "proposed" : undefined, limit: view === "review" ? 200 : 300,
    }),
  ]);
  const openCount = view === "review" ? adjustments.length
    : (await listAdjustments({ brandIds: inScope.map((x) => x.id), includeMaster: true, status: "proposed", limit: 500 })).length;

  const pbBrands = inScope.map((x) => ({ id: x.id, name: x.name, color: x.color, ...(() => {
    const r = brandAdjustRights(x.role);
    return { canPropose: r.propose, canApply: r.apply };
  })() }));

  const views: AdjustmentView[] = adjustments
    .filter((r) => view !== "history" || r.adjustment.status !== "proposed")
    .map(({ adjustment: a, rule }) => ({
      id: a.id, ruleName: rule.name, ruleCode: rule.code, brandId: a.brandId, field: a.field,
      before: a.before, after: a.after, reason: a.reason, evidence: a.evidence ?? null,
      status: a.status, source: a.source, actorKind: a.actorKind, actorName: a.actorName,
      decidedName: a.decidedName, decidedKind: a.decidedKind ?? null, decidedAt: a.decidedAt?.toISOString() ?? null,
      decisionNote: a.decisionNote, createdAt: a.createdAt.toISOString(),
      canDecide: a.brandId ? Boolean(pbBrands.find((x) => x.id === a.brandId)?.canApply) : master,
    }));

  return (
    <>
      <PageHeader
        icon={BookCheck}
        title="Playbook"
        subtitle="The master instructions for every post, reel, story and task — the limits the app checks by itself and the points people and agents confirm. Every brand follows it; each can tune it, and every change is reviewed daily."
      />

      <nav className="mb-5 flex flex-wrap items-center gap-1 border-b border-border" aria-label="Playbook views">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <Link key={id} href={href(id, b)}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${view === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text"}`}>
            <Icon className="size-3.5" /> {label}
            {id === "review" && openCount > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">{openCount}</span>}
          </Link>
        ))}
        {view === "rules" && (
          <div className="ml-auto flex flex-wrap gap-1 pb-1.5">
            <Link href={href("rules", "master")}
              className={`rounded-full border px-2.5 py-1 text-xs ${brandId === null ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted hover:bg-surface-2"}`}>
              Master
            </Link>
            {inScope.map((x) => (
              <Link key={x.id} href={href("rules", x.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${brandId === x.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted hover:bg-surface-2"}`}>
                <span className="size-2 rounded-full" style={{ background: x.color }} /> {x.name}
              </Link>
            ))}
          </div>
        )}
      </nav>

      {view === "rules" ? (
        <PlaybookRules
          rules={rules.map((r) => ({
            id: r.id, code: r.code, kind: r.kind, name: r.name, description: r.description, instructions: r.instructions,
            platforms: r.platforms, activityCodes: r.activityCodes, enforce: r.enforce, limits: r.limits, checklist: r.checklist,
            isCustom: r.isCustom, archived: Boolean(r.archivedAt),
          }))}
          brands={pbBrands}
          effective={Object.fromEntries(playbooks)}
          brandId={brandId}
          canEditMaster={master}
          platformOptions={PLATFORM_LIST.map((p) => ({ id: p.id, name: p.name })).sort((a, c) => a.name.localeCompare(c.name))}
        />
      ) : (
        <PlaybookReview adjustments={views} brands={inScope} mode={view === "review" ? "open" : "history"} />
      )}
    </>
  );
}
