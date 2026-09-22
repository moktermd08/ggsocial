import Link from "next/link";
import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import { AlertTriangle, BookOpen, Clock, Goal as GoalIcon, LineChart, Plus, ShieldCheck, Target } from "lucide-react";
import { requireUser, getMyBrands, can, atLeast, type BrandWithRole } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, channels, goals, metricSnapshots } from "@/lib/db";
import { platformOrNull } from "@/lib/platforms";
import { todayIn } from "@/lib/activities/periods";
import { PACE_META, compact, targetPhrase } from "@/lib/goals/meta";
import { getActivityTemplates } from "@/server/activities";
import { getGoalSummary, getGoalTemplates, getGoalsForBrands, proposedCounts, type GoalSummary } from "@/server/goals";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { PlatformIcon } from "@/components/platform-icon";
import { SnapshotLogger, type LoggerBrand, type LoggerReading } from "@/components/snapshot-logger";
import { GoalTemplates } from "@/components/goal-templates";

type View = "goals" | "numbers" | "templates";
const VIEWS: { id: View; label: string; icon: typeof Target }[] = [
  { id: "goals", label: "Brand goals", icon: Target },
  { id: "numbers", label: "Log numbers", icon: LineChart },
  { id: "templates", label: "Master templates", icon: BookOpen },
];

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { v } = await searchParams;
  const view: View = VIEWS.some((x) => x.id === v) ? (v as View) : "goals";
  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const canCreate = inScope.some((b) => can.manageBrand(b.role));

  return (
    <>
      <PageHeader
        icon={GoalIcon}
        title="Goals"
        subtitle="Targets for each brand, turned into a weekly plan of activities — and re-planned every Monday from what actually worked."
        action={canCreate && <LinkButton href="/goals/new" variant="primary"><Plus className="size-4" /> New goal</LinkButton>}
      />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Goal views">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <Link key={id} href={id === "goals" ? "/goals" : `/goals?v=${id}`}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${view === id ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-text"}`}>
            <Icon className="size-3.5" /> {label}
          </Link>
        ))}
      </nav>

      {view === "templates" ? (
        <TemplatesView canEdit={user.isSuperAdmin || brands.some((b) => atLeast(b.role, "admin"))} brandIds={brands.map((b) => b.id)} />
      ) : inScope.length === 0 ? (
        <Card><EmptyState icon={Target} title="No brands yet" body="Add a brand, then give it goals." action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>} /></Card>
      ) : view === "numbers" ? (
        <NumbersView brands={inScope} />
      ) : (
        <GoalsView brands={inScope} canCreate={canCreate} />
      )}
    </>
  );
}

/* ------------------------------------------------------------ goal cards */

async function GoalsView({ brands, canCreate }: { brands: BrandWithRole[]; canCreate: boolean }) {
  const all = await getGoalsForBrands(brands.map((b) => b.id));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const live = all.filter((g) => g.status === "active" || g.status === "paused");
  const done = all.filter((g) => g.status === "achieved");
  const [summaries, proposed] = await Promise.all([
    Promise.all(live.map((g) => getGoalSummary(g, brandById.get(g.brandId)!))),
    proposedCounts(all.map((g) => g.id)),
  ]);

  if (all.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Target}
          title="No goals yet"
          body="Pick a target — 1M followers, 10k site visitors a month, 500 leads — and a deadline. The plan works out how many posts, videos, comments and group posts it takes each week, writes them into the activity checklists, and adjusts every Monday."
          action={canCreate ? <LinkButton href="/goals/new" variant="primary"><Plus className="size-4" /> Set the first goal</LinkButton> : undefined}
        />
      </Card>
    );
  }

  const groups = brands.map((b) => ({ brand: b, items: summaries.filter((s) => s.goal.brandId === b.id) })).filter((g) => g.items.length);
  return (
    <div className="space-y-6">
      {groups.map(({ brand, items }) => (
        <section key={brand.id}>
          {brands.length > 1 && (
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="size-2.5 rounded-full" style={{ background: brand.color }} /> {brand.name}</h2>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((s) => <GoalCard key={s.goal.id} s={s} proposed={proposed.get(s.goal.id) ?? 0} />)}
          </div>
        </section>
      ))}
      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Achieved</h2>
          <div className="flex flex-wrap gap-2">
            {done.map((g) => (
              <Link key={g.id} href={`/goals/${g.id}`} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2">
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: brandById.get(g.brandId)?.color }} />
                {g.name} · {targetPhrase(g.metric, g.targetValue)}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GoalCard({ s, proposed }: { s: GoalSummary; proposed: number }) {
  const g = s.goal;
  const pace = PACE_META[s.pace];
  const gap = g.targetValue - s.start;
  const plannedShare = gap > 0 ? Math.max(0, Math.min(1, (s.plannedNow - s.start) / gap)) : 0;
  const platform = g.platform ? platformOrNull(g.platform) : null;
  return (
    <Link href={`/goals/${g.id}`} className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-surface-2/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Badge color={s.meta.color}>{s.meta.label}</Badge>
            {platform ? <><PlatformIcon platform={platform.id} size={13} /> {platform.name}</> : "All platforms"}
            {g.status === "paused" && <Badge>paused</Badge>}
          </p>
          <h3 className="mt-1 truncate text-base font-semibold">{g.name}</h3>
        </div>
        <Badge color={pace.color}>{pace.label}</Badge>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {s.now === null ? "—" : compact(s.now)}
          <span className="text-sm font-normal text-muted"> / {targetPhrase(g.metric, g.targetValue)}</span>
        </p>
        {s.trend.length > 1 && <Sparkline values={s.trend} color={s.meta.color} className="h-8 w-24" />}
      </div>

      <div className="relative mt-2 h-2.5 rounded-full bg-surface-2" title={`${Math.round(s.progress * 100)}% of the way; the plan expects ${Math.round(plannedShare * 100)}% by today`}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(1, s.progress * 100)}%`, background: pace.color }} />
        <span className="absolute -top-1 h-4.5 w-0.5 rounded bg-text/70" style={{ left: `${plannedShare * 100}%` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-muted">
        <span>{Math.round(s.progress * 100)}% of the way · plan expects {Math.round(plannedShare * 100)}% today</span>
        <span>by {g.deadline} · {s.daysLeft} days left</span>
      </p>

      {s.top.length > 0 && g.status === "active" && (
        <div className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-xs">
          <p className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted">
            <span>This week&apos;s plan</span>
            <span className="inline-flex items-center gap-1"><Clock className="size-3" /> ~{s.hoursPerWeek} h</span>
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5">
            {s.top.map((d) => (
              <span key={d.code}>
                <b className="tabular-nums">{d.weeklyPlanned}</b> {d.unitLabel}
                <span className={`ml-1 tabular-nums ${d.doneThisWeek >= d.weeklyPlanned || (d.doneThisWeek >= d.plannedThisWeekSoFar && d.plannedThisWeekSoFar > 0) ? "text-ok" : d.frequency === "daily" || d.frequency === "every_2_days" ? "text-warn" : "text-muted"}`}>({Math.floor(d.doneThisWeek)} done)</span>
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="mt-3 space-y-1 text-xs">
        {s.projection.date && s.now !== null && s.now < g.targetValue && (
          <p className={s.projection.date <= g.deadline ? "text-ok" : "text-muted"}>
            At the last 4 weeks&apos; pace: lands {s.projection.date}{s.projection.date <= g.deadline ? " — before the deadline" : ""}.
          </p>
        )}
        {!s.feasible && (
          <p className="flex items-start gap-1.5 text-danger"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Not reachable by the deadline even at full capacity — see the plan.</p>
        )}
        {s.headline && s.headline.tone !== "info" && s.feasible && (
          <p className={s.headline.tone === "good" ? "text-ok" : "text-warn"}>{s.headline.text}</p>
        )}
        {proposed > 0 && (
          <p className="inline-flex items-center gap-1 font-medium text-accent"><ShieldCheck className="size-3.5" /> New plan waiting for approval</p>
        )}
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------- numbers */

async function NumbersView({ brands }: { brands: BrandWithRole[] }) {
  const ids = brands.map((b) => b.id);
  const [channelRows, lastRows, recentRows] = await Promise.all([
    db.select().from(channels).where(and(inArray(channels.brandId, ids), isNull(channels.archivedAt))).orderBy(channels.platform, channels.handle),
    db.execute<{ brand_id: string; scope_key: string; date: string; value: number; source: "manual" | "api" }>(sql`
      select distinct on (brand_id, scope_key) brand_id, scope_key, to_char(date, 'YYYY-MM-DD') as date, value, source
      from metric_snapshots where metric = 'followers' and brand_id in ${ids}
      order by brand_id, scope_key, date desc`),
    db.select().from(metricSnapshots).where(inArray(metricSnapshots.brandId, ids)).orderBy(desc(metricSnapshots.date), desc(metricSnapshots.updatedAt)).limit(30),
  ]);
  const last = new Map([...lastRows].map((r) => [`${r.brand_id}:${r.scope_key}`, { value: Number(r.value), date: r.date, source: r.source }]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const channelById = new Map(channelRows.map((c) => [c.id, c]));

  const logger: LoggerBrand[] = brands.map((b) => ({
    id: b.id, name: b.name, color: b.color, canEdit: can.edit(b.role),
    brandLast: last.get(`${b.id}:brand`) ?? null,
    channels: channelRows.filter((c) => c.brandId === b.id).map((c) => {
      const p = platformOrNull(c.platform);
      return {
        id: c.id, platform: c.platform, platformName: p?.name ?? c.platform, handle: c.handle, live: c.mode === "live",
        canPull: c.mode === "live" && Boolean(p?.fetchAccountStats),
        last: last.get(`${b.id}:${c.id}`) ?? null,
      };
    }),
  }));
  const recent: LoggerReading[] = recentRows.map((r) => {
    const c = r.channelId ? channelById.get(r.channelId) : null;
    return {
      brandId: r.brandId, brandName: brandById.get(r.brandId)?.name ?? "", channelId: r.channelId,
      where: c ? `${platformOrNull(c.platform)?.name ?? c.platform} · ${c.handle}` : r.channelId ? "archived channel" : "whole brand",
      metric: r.metric, date: r.date, value: r.value, source: r.source,
    };
  });
  return <SnapshotLogger brands={logger} today={todayIn(brands[0]?.timezone ?? "UTC")} recent={recent} />;
}

/* ------------------------------------------------------------ templates */

async function TemplatesView({ canEdit, brandIds }: { canEdit: boolean; brandIds: string[] }) {
  const [templates, activities, counts] = await Promise.all([
    getGoalTemplates({ includeArchived: true }),
    getActivityTemplates(),
    brandIds.length
      ? db.select({ templateId: goals.templateId, n: sql<number>`count(*)::int` }).from(goals)
          .where(inArray(goals.brandId, brandIds)).groupBy(goals.templateId)
      : Promise.resolve([] as { templateId: string | null; n: number }[]),
  ]);
  const countBy = new Map(counts.map((c) => [c.templateId, c.n]));
  return (
    <GoalTemplates
      canEdit={canEdit}
      activities={activities.map((a) => ({ code: a.code, title: a.title }))}
      templates={templates.map((t) => ({
        id: t.id, code: t.code, metric: t.metric, name: t.name, description: t.description, drivers: t.drivers,
        isCustom: t.isCustom, archived: Boolean(t.archivedAt), goalCount: countBy.get(t.id) ?? 0,
      }))}
    />
  );
}

