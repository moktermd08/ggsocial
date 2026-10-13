import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getCalendarPosts } from "@/server/queries";
import { projectIdeas } from "@/server/projection";
import { draftingConfigured } from "@/server/drafting";
import { IdeaCard, IdeaPickProvider, type PickIdea } from "@/components/idea-pick";
import { db, posts, postVersions } from "@/lib/db";
import { CalendarGrid, type CalendarItem } from "@/components/calendar-grid";
import { CalendarAgenda } from "@/components/calendar-agenda";
import { LinkButton, PageHeader, buttonClass } from "@/components/ui";
import { truncate } from "@/lib/format";
import { FORMAT_META, isFormat } from "@/lib/formats";
import { CALENDAR_FILTERS, calendarAction, inFilter, type CalendarFilter } from "@/lib/calendar";

function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  // Monday-first grid.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86400_000);
  const todayKey = new Date().toISOString().slice(0, 10);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, inMonth: d.getUTCMonth() === month, isToday: key === todayKey, label: String(d.getUTCDate()) };
  });
}

function localParts(at: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; show?: string; view?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { m, show, view } = await searchParams;
  const filter: CalendarFilter = CALENDAR_FILTERS.some((f) => f.key === show) ? (show as CalendarFilter) : "all";
  const agenda = view === "agenda";

  const now = new Date();
  const [y, mo] = m ? m.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const year = y ?? now.getUTCFullYear();
  const month = (mo ?? now.getUTCMonth() + 1) - 1;

  const days = monthGrid(year, month);
  const from = new Date(`${days[0].date}T00:00:00Z`);
  const to = new Date(`${days[41].date}T23:59:59Z`);
  const [dated, undated, ideas] = await Promise.all([
    getCalendarPosts(scope.brandIds, from, to),
    // Work with no date yet: it belongs on the calendar's to-do side, not nowhere.
    scope.brandIds.length
      ? db.select().from(posts).where(and(
          inArray(posts.brandId, scope.brandIds), isNull(posts.scheduledAt),
          inArray(posts.status, ["draft", "in_review", "changes_requested", "approved"]),
        )).orderBy(asc(posts.updatedAt)).limit(40)
      : [],
    projectIdeas({
      userId: user.id, myBrandIds: brands.map((b) => b.id),
      brands: brands.filter((b) => scope.brandIds.includes(b.id)).map((b) => ({ id: b.id, timezone: b.timezone })),
    }),
  ]);

  const timezone = scope.activeBrand?.timezone ?? "UTC";
  const roleByBrand = new Map(brands.map((b) => [b.id, b.role]));
  const brandById = new Map(brands.map((b) => [b.id, b]));

  // The formats each post is being sent in, from the versions its channels point at.
  const versionIds = [...new Set(dated.flatMap((p) => p.targets.map((t) => t.versionId).filter((v): v is string => Boolean(v))))];
  const versionRows = versionIds.length ? await db.select().from(postVersions).where(inArray(postVersions.id, versionIds)) : [];
  const formatOf = new Map(versionRows.map((v) => [v.id, v.format]));

  // One entry per post per time: a post whose channels post at different times shows at each.
  const items: CalendarItem[] = dated.flatMap((p) => {
    if (!p.scheduledAt) return [];
    const zone = scope.activeBrand ? timezone : p.brand.timezone;
    const groups = new Map<string, { day: string; time: string; platforms: string[]; formats: Set<string>; statuses: string[] }>();
    const entries = p.targets.length ? p.targets : [null];
    for (const t of entries) {
      const at = t?.scheduledAt ?? p.scheduledAt;
      const { day, time } = localParts(at, zone);
      const g = groups.get(`${day} ${time}`) ?? { day, time, platforms: [], formats: new Set<string>(), statuses: [] };
      if (t) {
        g.platforms.push(t.channel.platform);
        g.statuses.push(t.status);
        const f = t.versionId ? formatOf.get(t.versionId) : p.postType;
        if (isFormat(f)) g.formats.add(FORMAT_META[f].label);
      }
      groups.set(`${day} ${time}`, g);
    }
    const title = p.title || truncate(p.body, 48) || "Untitled";
    return [...groups.values()].map((g) => ({
      id: p.id,
      title,
      status: p.status,
      brandName: p.brand.name,
      brandColor: p.brand.color,
      day: g.day,
      time: g.time,
      platforms: g.platforms,
      formats: [...g.formats],
      action: calendarAction(p.status, g.statuses),
      canEdit: can.edit(roleByBrand.get(p.brandId) ?? "viewer"),
    }));
  });

  // Ideas not yet written, on the days the content writer would book them.
  // One entry per idea per time: brands that would tell it together share it.
  const merged = new Map<string, { p: (typeof ideas.projected)[number]; day: string; time: string; names: string[]; pinned: boolean }>();
  for (const p of ideas.projected) {
    const { day, time } = localParts(p.at, scope.activeBrand ? timezone : brandById.get(p.brandId)?.timezone ?? "UTC");
    const k = `${p.ideaId}|${day}|${time}`;
    const g = merged.get(k);
    if (g) g.names.push(p.brandName); else merged.set(k, { p, day, time, names: [p.brandName], pinned: p.pinned });
  }
  const forecast: CalendarItem[] = [...merged.values()].map(({ p, day, time, names, pinned }) => ({
    id: p.ideaId, title: p.title, status: "draft" as const,
    brandName: names.length > 2 ? `${names.length} brands` : names.join(", "),
    brandColor: names.length > 1 ? "#a855f7" : p.brandColor,
    day, time, platforms: [], formats: [],
    action: pinned ? "Idea · pinned" : p.status === "planned" ? "Idea · planned" : "Idea · backlog",
    projected: true, href: "/ideas", canEdit: false,
  }));
  const firstDay = new Map<string, string>();
  for (const f of [...forecast].sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time))) if (!firstDay.has(f.id)) firstDay.set(f.id, f.day);
  const pickIdeas: PickIdea[] = ideas.waiting.map(({ idea, missing }) => ({
    id: idea.id, title: idea.title || idea.problem, status: idea.status, pillar: idea.pillar,
    brands: missing.map((b) => ({ id: b.id, name: b.name, color: b.color })), day: firstDay.get(idea.id) ?? null, pinned: Boolean(idea.plannedFor),
  }));
  const all = [...items, ...forecast];
  const visible = all.filter((i) => inFilter(filter, i.status, i.action, i.projected));
  const counts = Object.fromEntries(CALENDAR_FILTERS.map((f) => [f.key, all.filter((i) => inFilter(f.key, i.status, i.action, i.projected)).length])) as Record<CalendarFilter, number>;

  const todo: CalendarItem[] = undated.map((p) => ({
    id: p.id, title: p.title || truncate(p.body, 48) || "Untitled", status: p.status,
    brandName: brandById.get(p.brandId)?.name ?? "", brandColor: brandById.get(p.brandId)?.color ?? "#6366f1",
    day: "", time: "", platforms: [], formats: [], action: calendarAction(p.status, []),
    canEdit: can.edit(roleByBrand.get(p.brandId) ?? "viewer"),
  }));

  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month, 1)));
  const prev = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const href = (over: { m?: string; show?: string; view?: string }) => {
    const q = new URLSearchParams();
    const mm = over.m ?? m; const ss = over.show ?? filter; const vv = over.view ?? (agenda ? "agenda" : "");
    if (mm) q.set("m", mm);
    if (ss && ss !== "all") q.set("show", ss);
    if (vv) q.set("view", vv);
    const s = q.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };

  return (
    <IdeaPickProvider ideas={pickIdeas} aiReady={draftingConfigured()}>
      <PageHeader
        icon={CalendarDays}
        title={label}
        subtitle={`Times in ${scope.activeBrand ? timezone : "each brand's timezone"} · drag to move a post · channels post only at their own times`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-border text-xs">
              <Link href={href({ view: "" })} className={`px-2.5 py-1 ${!agenda ? "bg-accent-soft font-medium" : "hover:bg-surface-2"}`}>Month</Link>
              <Link href={href({ view: "agenda" })} className={`px-2.5 py-1 ${agenda ? "bg-accent-soft font-medium" : "hover:bg-surface-2"}`}>Agenda</Link>
            </div>
            <Link href={href({ m: key(prev) })} className={buttonClass("subtle", "sm")}><ChevronLeft className="size-4" /></Link>
            <Link href={href({ m: "" })} className={buttonClass("subtle", "sm")}>Today</Link>
            <Link href={href({ m: key(next) })} className={buttonClass("subtle", "sm")}><ChevronRight className="size-4" /></Link>
            <LinkButton href="/posts/new" variant="primary" size="sm">New post</LinkButton>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        {CALENDAR_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ show: f.key })}
            aria-current={filter === f.key ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              filter === f.key ? "border-accent bg-accent-soft font-medium" : "border-border bg-surface hover:bg-surface-2"
            }`}
          >
            <span className="size-2 rounded-full" style={{ background: f.color }} />
            {f.label}
            <span className="tabular-nums text-muted">{counts[f.key]}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        {agenda
          ? <CalendarAgenda items={visible} timezone={timezone} />
          : <CalendarGrid days={days} items={visible} timezone={timezone} />}
        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Needs a date ({todo.length})</h2>
          {todo.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">Every draft and approved post has a date.</p>
          ) : todo.map((t) => (
            <Link key={t.id} href={`/posts/${t.id}`} className="block rounded-lg border border-border bg-surface p-2.5 text-xs hover:bg-surface-2" style={{ borderLeft: `3px solid ${t.brandColor}` }}>
              <p className="line-clamp-2 font-medium">{t.title}</p>
              <p className="mt-0.5 text-muted">{t.brandName}{t.action ? ` · ${t.action}` : ""}</p>
            </Link>
          ))}
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Ideas waiting ({ideas.waiting.length})</h2>
          {ideas.waiting.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">Every idea in the plan is on the calendar.</p>
          ) : pickIdeas.slice(0, 12).map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
          {pickIdeas.length > 0 && <p className="text-[11px] text-muted">Click an idea, or drag it onto a day, to put it on the calendar.</p>}
        </aside>
      </div>
    </IdeaPickProvider>
  );
}
