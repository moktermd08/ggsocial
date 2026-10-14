import { CalendarDay, type DaySlot } from "./calendar-day";
import type { CalendarItem } from "./calendar-grid";
import { DayDrop } from "./idea-pick";

/**
 * The calendar as a list: today onwards, grouped by day, each day laid out as
 * its posting slots (see `CalendarDay`) with what is booked or forecast in
 * them and the slots still open. The next two weeks always show, so an idea
 * can be dropped on a day with nothing in it yet.
 */
export function CalendarAgenda({ items, slotsByDay, timezone }: {
  items: CalendarItem[]; slotsByDay: Record<string, DaySlot[]>; timezone: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of items.filter((x) => x.day >= today).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time))) {
    byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  }
  for (const d of Object.keys(slotsByDay)) if (!byDay.has(d)) byDay.set(d, []);
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      {days.map(([day, list]) => (
        <DayDrop key={day} day={day}>
          <h2 className="mb-1.5 text-xs font-semibold text-muted">
            {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}
            {day === today ? " · today" : ""}
          </h2>
          {list.length === 0 && (slotsByDay[day]?.length ?? 0) === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted">No channel posts this day. Drop an idea here.</p>
          ) : (
            <CalendarDay day={day} items={list} slots={slotsByDay[day] ?? []} timezone={timezone} />
          )}
        </DayDrop>
      ))}
    </div>
  );
}
