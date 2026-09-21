import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { getCalendarPosts } from "@/server/queries";
import { CalendarGrid, type CalendarItem } from "@/components/calendar-grid";
import { LinkButton, PageHeader, buttonClass } from "@/components/ui";
import { truncate } from "@/lib/format";

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

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const { m } = await searchParams;

  const now = new Date();
  const [y, mo] = m ? m.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const year = y ?? now.getUTCFullYear();
  const month = (mo ?? now.getUTCMonth() + 1) - 1;

  const days = monthGrid(year, month);
  const from = new Date(`${days[0].date}T00:00:00Z`);
  const to = new Date(`${days[41].date}T23:59:59Z`);
  const posts = await getCalendarPosts(scope.brandIds, from, to);

  const timezone = scope.activeBrand?.timezone ?? "UTC";
  const roleByBrand = new Map(brands.map((b) => [b.id, b.role]));

  const items: CalendarItem[] = posts
    .filter((p) => p.scheduledAt)
    .map((p) => {
      const zone = scope.activeBrand ? timezone : p.brand.timezone;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(p.scheduledAt!);
      const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
      return {
        id: p.id,
        title: p.title || truncate(p.body, 48) || "Untitled",
        status: p.status,
        brandName: p.brand.name,
        brandColor: p.brand.color,
        day: `${get("year")}-${get("month")}-${get("day")}`,
        time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`,
        platforms: p.targets.map((t) => t.channel.platform),
        canEdit: can.edit(roleByBrand.get(p.brandId) ?? "viewer"),
      };
    });

  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month, 1)));
  const prev = new Date(Date.UTC(year, month - 1, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  return (
    <>
      <PageHeader
        icon={CalendarDays}
        title={label}
        subtitle={`Times shown in ${scope.activeBrand ? timezone : "each brand's own timezone"} · drag a post to move it`}
        action={
          <div className="flex items-center gap-2">
            <Link href={`/calendar?m=${key(prev)}`} className={buttonClass("subtle", "sm")}><ChevronLeft className="size-4" /></Link>
            <Link href="/calendar" className={buttonClass("subtle", "sm")}>Today</Link>
            <Link href={`/calendar?m=${key(next)}`} className={buttonClass("subtle", "sm")}><ChevronRight className="size-4" /></Link>
            <LinkButton href="/posts/new" variant="primary" size="sm">New post</LinkButton>
          </div>
        }
      />
      <CalendarGrid days={days} items={items} timezone={timezone} />
    </>
  );
}
