import Link from "next/link";
import { PlatformIcon } from "./platform-icon";
import { STATUS_META } from "@/lib/format";
import { tintedInk } from "@/lib/color";
import type { CalendarItem } from "./calendar-grid";
import { DayDrop, PickEntry } from "./idea-pick";

/**
 * The calendar as a list: what is next, when it goes out, what it needs from
 * someone. Today onwards, grouped by day. An idea's forecast entry opens the
 * picker; everything else opens its post.
 */
export function CalendarAgenda({ items, timezone }: { items: CalendarItem[]; timezone: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = items.filter((i) => i.day >= today).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of upcoming) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);

  // The next two weeks always show, so an idea can be dropped on a day with nothing in it yet.
  for (let n = 0; n < 14; n++) {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted">Drag an idea (dashed purple) to another day to pin it there.</p>
      {days.map(([day, list]) => (
        <DayDrop key={day} day={day}>
          <h2 className="mb-1.5 text-xs font-semibold text-muted">
            {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}
            {day === today ? " · today" : ""}
          </h2>
          {list.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted">Nothing planned. Drop an idea here.</p>
          ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {list.map((i, n) => {
              const meta = STATUS_META[i.status];
              const row = "flex items-start gap-3 px-3 py-2.5 hover:bg-surface-2";
              const edge = { borderLeft: `3px solid ${i.brandColor}` };
              const inner = (
                <>
                  <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted" title={timezone}>{i.time}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {i.brandName}{i.projected ? " · forecast, click to put it on the calendar" : i.formats.length ? ` · ${i.formats.join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-0.5 pt-0.5">
                    {i.platforms.slice(0, 5).map((p, k) => <PlatformIcon key={k} platform={p} size={16} />)}
                  </div>
                  <span className="w-32 shrink-0 text-right text-[11px] font-medium" style={{ color: tintedInk(i.projected ? "#a855f7" : meta.color) }}>
                    {i.action ?? meta.label}
                  </span>
                </>
              );
              return (
                <li key={`${i.id}-${i.time}-${n}`}>
                  {i.projected
                    ? <PickEntry ideaId={i.id} day={i.day} className={`${row} bg-surface-2/40`} style={edge}>{inner}</PickEntry>
                    : <Link href={`/posts/${i.id}`} className={row} style={edge}>{inner}</Link>}
                </li>
              );
            })}
          </ul>
          )}
        </DayDrop>
      ))}
    </div>
  );
}
