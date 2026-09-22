import Link from "next/link";
import { headers } from "next/headers";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  Bot, CalendarRange, ChevronLeft, ChevronRight, CircleCheck, ClipboardCheck, Flame, Library, ListChecks, ShieldCheck, TrendingUp,
} from "lucide-react";
import { requireUser, getMyBrands, can, atLeast, type BrandWithRole } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, agentTokens, brandActivitySettings, channels } from "@/lib/db";
import { PLATFORM_LIST } from "@/lib/platforms";
import { FREQUENCIES, FREQUENCY_META, CATEGORY_META, type Frequency } from "@/lib/activities/meta";
import { isDateKey, periodFor, todayIn } from "@/lib/activities/periods";
import { completion, getActivityReport, getActivityTemplates, getChecklist } from "@/server/activities";
import { ActivityChecklist, type ChecklistRowView } from "@/components/activity-checklist";
import { ActivityLibrary, type LibrarySetting } from "@/components/activity-library";
import { AgentAccess } from "@/components/agent-access";
import { BarList, Ring } from "@/components/charts";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, StatTile, buttonClass } from "@/components/ui";
import { tintedInk, tintedSurface } from "@/lib/color";

type View = Frequency | "report" | "library" | "agents";
const EXTRA_VIEWS: { id: View; label: string; icon: typeof Library }[] = [
  { id: "report", label: "Report", icon: TrendingUp },
  { id: "library", label: "Master list", icon: Library },
  { id: "agents", label: "AI agents", icon: Bot },
];

function href(view: View, date?: string) {
  const q = new URLSearchParams({ f: view });
  if (date) q.set("d", date);
  return `/activities?${q}`;
}

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ f?: string; d?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { f, d } = await searchParams;

  const view: View = FREQUENCIES.includes(f as Frequency) || EXTRA_VIEWS.some((v) => v.id === f) ? (f as View) : "daily";
  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const today = todayIn(scope.activeBrand?.timezone ?? inScope[0]?.timezone ?? "UTC");
  const date = isDateKey(d) ? d : today;

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title="Activities"
        subtitle="The recurring work that keeps every profile current and bringing in leads. One master list, one plan per brand, ticked off by people or AI agents."
      />

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Activity views">
        {FREQUENCIES.map((fq) => (
          <Link key={fq} href={href(fq)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm ${view === fq ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text"}`}>
            {FREQUENCY_META[fq].label}
          </Link>
        ))}
        <span className="mx-1 my-2 w-px shrink-0 bg-border" />
        {EXTRA_VIEWS.map(({ id, label, icon: Icon }) => (
          <Link key={id} href={href(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${view === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text"}`}>
            <Icon className="size-3.5" /> {label}
          </Link>
        ))}
      </nav>

      {inScope.length === 0 && view !== "library" && view !== "agents" ? (
        <Card><EmptyState icon={ListChecks} title="No brands yet" body="Add a brand and its action plan appears here." action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>} /></Card>
      ) : view === "library" ? (
        <LibraryView brands={inScope.length ? inScope : brands} userIsSuperAdmin={user.isSuperAdmin} allBrands={brands} />
      ) : view === "agents" ? (
        <AgentsView userId={user.id} />
      ) : view === "report" ? (
        <ReportView brands={inScope} today={today} />
      ) : (
        <ChecklistView brands={inScope} frequency={view} date={date} today={today} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ checklist */

async function ChecklistView({ brands, frequency, date, today }: { brands: BrandWithRole[]; frequency: Frequency; date: string; today: string }) {
  const { period, phase, rows } = await getChecklist({ brands, frequency, date, today });
  const cells = rows.flatMap((r) => r.cells);
  const done = completion(cells);
  const recorded = cells.filter((c) => c.check);
  const awaitingReview = recorded.filter((c) => c.check!.status !== "skipped" && !c.check!.reviewStatus).length;
  const toRedo = recorded.filter((c) => c.check!.reviewStatus === "rejected").length;
  const open = cells.filter((c) => c.applies && (c.status === "open" || c.status === "missed")).length;
  const current = periodFor(frequency, today);

  const views: ChecklistRowView[] = rows.map(({ template: t, cells }) => ({
    id: t.id, code: t.code, title: t.title, description: t.description, category: t.category, platforms: t.platforms,
    unit: t.unit, proof: t.proof, performer: t.performer, leadImpact: t.leadImpact, estMinutes: t.estMinutes,
    cells: cells.map((c) => ({
      brandId: c.brandId, applies: c.applies, target: c.target, status: c.status,
      count: c.check?.count ?? null, proofUrl: c.check?.proofUrl ?? null, notes: c.check?.notes ?? null,
      doneByKind: c.check?.doneByKind ?? null, doneByName: c.check?.doneByName ?? null, doneByUser: c.doneByUser, source: c.check?.source ?? null,
      doneAt: c.check?.doneAt.toISOString() ?? null,
      review: c.check?.reviewStatus ?? null, reviewNote: c.check?.reviewNote ?? null,
      reviewerKind: c.check?.reviewerKind ?? null,
      reviewerName: c.check?.reviewerKind === "ai" ? c.check.reviewerName : c.reviewedByUser ?? c.check?.reviewerName ?? null,
      reviewedAt: c.check?.reviewedAt?.toISOString() ?? null,
    })),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href(frequency, period.prev)} className={buttonClass("subtle", "sm")} aria-label="Previous period"><ChevronLeft className="size-4" /></Link>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <CalendarRange className="size-4 text-muted" /> {period.label}
          {phase === "current" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">current</span>}
        </h2>
        <Link href={href(frequency, period.next)} className={buttonClass("subtle", "sm")} aria-label="Next period"><ChevronRight className="size-4" /></Link>
        {period.key !== current.key && <Link href={href(frequency)} className={buttonClass("ghost", "sm")}>Back to this {FREQUENCY_META[frequency].noun}</Link>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex items-center gap-3 p-4">
          <Ring value={done.score} total={done.total} color={done.pct >= 80 ? "var(--ok)" : done.pct >= 50 ? "var(--warn)" : "var(--danger)"}>{done.pct}%</Ring>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{done.score % 1 ? done.score.toFixed(1) : done.score}<span className="text-sm font-normal text-muted">/{done.total}</span></p>
            <p className="text-xs text-muted">complete</p>
          </div>
        </Card>
        <StatTile label={phase === "past" ? "Missed" : "Still to do"} value={open} icon={phase === "past" ? Flame : ListChecks} tone={open ? "#b45309" : "#15803d"} />
        <StatTile label="Awaiting review" value={awaitingReview} icon={ShieldCheck} tone="#4f46e5" />
        <StatTile label="Sent back to redo" value={toRedo} icon={CircleCheck} tone={toRedo ? "#b91c1c" : "#15803d"} />
      </div>

      {brands.length > 1 && (
        <Card className="grid gap-x-6 gap-y-2 p-4 sm:grid-cols-2">
          {brands.map((b, i) => {
            const c = completion(rows.map((r) => r.cells[i]));
            return (
              <div key={b.id} className="flex items-center gap-2 text-xs">
                <span className="size-2 shrink-0 rounded-full" style={{ background: b.color }} />
                <span className="w-28 truncate font-medium">{b.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: b.color }} />
                </div>
                <span className="w-24 whitespace-nowrap text-right tabular-nums text-muted">{c.pct}% · {c.total - Math.ceil(c.score)} left</span>
              </div>
            );
          })}
        </Card>
      )}

      {rows.length === 0 ? (
        <Card><EmptyState icon={ListChecks} title={`No ${FREQUENCY_META[frequency].label.toLowerCase()} activities on these brands' plans`} body="Switch activities on in the master list." action={<LinkButton href={href("library")}>Open the master list</LinkButton>} /></Card>
      ) : (
        <ActivityChecklist
          brands={brands.map((b) => ({ id: b.id, name: b.name, color: b.color, canEdit: can.edit(b.role), canReview: can.approve(b.role) || can.edit(b.role) }))}
          rows={views}
          date={period.start}
          phase={phase}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- report */

async function ReportView({ brands, today }: { brands: BrandWithRole[]; today: string }) {
  const report = await getActivityReport(brands, today);

  function tone(pct: number, total: number) {
    if (total === 0) return { background: "transparent", color: "var(--muted)" };
    const hue = pct >= 80 ? "#15803d" : pct >= 50 ? "#b45309" : "#b91c1c";
    return { background: tintedSurface(hue, 10 + Math.round(pct / 8)), color: tintedInk(hue, 85) };
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["daily", "weekly", "monthly", "quarterly"] as const).map((fq) => {
          const s = report.frequencies.find((x) => x.frequency === fq)!.series;
          const now = s[s.length - 1];
          return (
            <StatTile key={fq} label={`${FREQUENCY_META[fq].label} · ${now.period.short}`} value={`${now.pct}%`} icon={TrendingUp}
              tone={now.pct >= 80 ? "#15803d" : now.pct >= 50 ? "#b45309" : "#b91c1c"} href={href(fq)}
              trend={s.map((p) => p.pct)} hint={`${Math.round(now.score)} of ${now.total} done`} />
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-x-auto">
          <CardHeader icon={CalendarRange} title="Completion by period" subtitle="Done counts 1, partly done ½; skipped items leave the total. Click a cell to open that checklist." />
          <div className="space-y-5 p-4">
            {report.frequencies.map(({ frequency, series }) => (
              <div key={frequency}>
                <p className="mb-1.5 text-xs font-semibold">{FREQUENCY_META[frequency].label}</p>
                <table className="w-full border-separate border-spacing-0.5 text-[11px]">
                  <thead>
                    <tr className="text-muted">
                      <th className="w-28 text-left font-normal" />
                      {series.map((p) => <th key={p.period.key} className="font-normal">{p.period.short}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[{ id: "all", name: "All brands", color: "var(--text)" }, ...(brands.length > 1 ? brands : [])].map((b, bi) => (
                      <tr key={b.id}>
                        <td className="truncate pr-2 font-medium">
                          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: b.color }} />{b.name}</span>
                        </td>
                        {series.map((p) => {
                          const cell = bi === 0 ? p : p.perBrand.find((x) => x.brandId === b.id)!;
                          return (
                            <td key={p.period.key} className="p-0 text-center">
                              <Link href={href(frequency, p.period.start)} className="block rounded px-1 py-1 tabular-nums hover:ring-1 hover:ring-accent"
                                style={tone(cell.pct, cell.total)} title={`${p.period.label}: ${Math.round(cell.score)} of ${cell.total}`}>
                                {cell.total ? `${cell.pct}` : "–"}
                              </Link>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={Flame} title="Most often missed" subtitle="Across the periods above — the habits to fix first." />
            <div className="p-4">
              {report.mostMissed.length === 0 ? <p className="text-sm text-muted">Nothing missed yet.</p> : (
                <BarList
                  color="var(--danger)"
                  valueLabel="times missed"
                  items={report.mostMissed.map(({ template: t, count }) => ({
                    key: t.id,
                    label: <><span className="mr-1 font-mono text-[10px] text-muted">{t.code}</span>{t.title}</>,
                    sub: FREQUENCY_META[t.frequency].short,
                    value: count,
                    icon: <span className="size-2 shrink-0 rounded-sm" style={{ background: CATEGORY_META[t.category].color }} />,
                  }))}
                />
              )}
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Done by AI agents" value={report.totals.doneByAi} icon={Bot} tone="#7c3aed" hint={`of ${report.totals.recorded} recorded`} />
            <StatTile label="Awaiting review" value={report.totals.awaitingReview} icon={ShieldCheck} tone="#4f46e5" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- library */

async function LibraryView({ brands, allBrands, userIsSuperAdmin }: { brands: BrandWithRole[]; allBrands: BrandWithRole[]; userIsSuperAdmin: boolean }) {
  const brandIds = brands.map((b) => b.id);
  const [templates, settingRows, channelRows] = await Promise.all([
    getActivityTemplates({ includeArchived: true }),
    brandIds.length ? db.select().from(brandActivitySettings).where(inArray(brandActivitySettings.brandId, brandIds)) : [],
    brandIds.length
      ? db.select({ brandId: channels.brandId, platform: channels.platform }).from(channels)
          .where(and(inArray(channels.brandId, brandIds), isNull(channels.archivedAt)))
      : [],
  ]);

  const settings: Record<string, LibrarySetting> = {};
  for (const s of settingRows) settings[`${s.brandId}:${s.templateId}`] = { enabled: s.enabled, target: s.target, byGoal: Boolean(s.goalId) };

  return (
    <ActivityLibrary
      templates={templates.map((t) => ({
        id: t.id, code: t.code, title: t.title, description: t.description, category: t.category, frequency: t.frequency,
        platforms: t.platforms, target: t.target, unit: t.unit, proof: t.proof, performer: t.performer,
        leadImpact: t.leadImpact, estMinutes: t.estMinutes, isCustom: t.isCustom, archived: Boolean(t.archivedAt),
      }))}
      brands={brands.map((b) => ({
        id: b.id, name: b.name, color: b.color, canManage: can.manageBrand(b.role),
        platforms: [...new Set(channelRows.filter((c) => c.brandId === b.id).map((c) => c.platform))],
      }))}
      settings={settings}
      canEditMaster={userIsSuperAdmin || allBrands.some((b) => atLeast(b.role, "admin"))}
      platformOptions={PLATFORM_LIST.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))}
    />
  );
}

/* --------------------------------------------------------------- agents */

async function AgentsView({ userId }: { userId: string }) {
  const h = await headers();
  const origin = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const tokens = await db.select().from(agentTokens).where(eq(agentTokens.userId, userId)).orderBy(desc(agentTokens.createdAt));
  return (
    <AgentAccess
      appUrl={origin}
      tokens={tokens.map((t) => ({
        id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revoked: Boolean(t.revokedAt),
      }))}
    />
  );
}
