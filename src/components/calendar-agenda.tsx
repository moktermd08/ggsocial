import Link from "next/link";
import { PlatformIcon } from "./platform-icon";
import { STATUS_META } from "@/lib/format";
import { tintedInk } from "@/lib/color";
import type { CalendarItem } from "./calendar-grid";

/**
 * The calendar as a list: what is next, when it goes out, what it needs from
 * someone. Today onwards, grouped by day.
 */
export function CalendarAgenda({ items, timezone }: { items: CalendarItem[]; timezone: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = items.filter((i) => i.day >= today).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of upcoming) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);

  if (byDay.size === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">Nothing planned from today in this view.</p>;
  }
  return (
    <div className="space-y-4">
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-1.5 text-xs font-semibold text-muted">
            {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}
            {day === today ? " · today" : ""}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {list.map((i, n) => {
              const meta = STATUS_META[i.status];
              return (
                <li key={`${i.id}-${i.time}-${n}`}>
                  <Link href={i.href ?? `/posts/${i.id}`} className={`flex items-start gap-3 px-3 py-2.5 hover:bg-surface-2 ${i.projected ? "bg-surface-2/40" : ""}`} style={{ borderLeft: `3px solid ${i.brandColor}` }}>
                    <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted" title={timezone}>{i.time}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {i.brandName}{i.projected ? " · forecast, not booked" : i.formats.length ? ` · ${i.formats.join(", ")}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-0.5 pt-0.5">
                      {i.platforms.slice(0, 5).map((p, k) => <PlatformIcon key={k} platform={p} size={16} />)}
                    </div>
                    <span className="w-32 shrink-0 text-right text-[11px] font-medium" style={{ color: tintedInk(i.projected ? "#a855f7" : meta.color) }}>
                      {i.action ?? meta.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
