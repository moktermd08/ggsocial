"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlatformIcon } from "./platform-icon";
import { IDEA_DRAG_TYPE, IDEA_MOVE_TYPE, useIdeaPick } from "./idea-pick";
import { STATUS_META } from "@/lib/format";
import { tintedInk } from "@/lib/color";
import { pinIdeaToDayAction } from "@/server/actions/ideas";
import { reschedulePostAction } from "@/server/actions/posts";
import type { CalendarItem } from "./calendar-grid";
import type { DaySlot } from "./calendar-day";

/**
 * The week as a timetable: a row for every time a channel may post that week,
 * a column for each day. Booked posts and forecast ideas sit where they go
 * out; a slot that is free on a day shows as open. Drop an idea on a cell to
 * pin it to that day and time, or a post to move it there.
 */
export function CalendarWeekSlots({ days, items, slotsByDay, timezone }: {
  days: { date: string; isToday: boolean; label: string }[];
  items: CalendarItem[];
  slotsByDay: Record<string, DaySlot[]>;
  timezone: string;
}) {
  const router = useRouter();
  const pick = useIdeaPick();
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const times = [...new Set([...Object.values(slotsByDay).flatMap((s) => s.map((x) => x.time)), ...items.map((i) => i.time)])].sort();
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  if (times.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No channel posts this week, and nothing is planned for it.</p>;
  }

  const drop = (e: React.DragEvent, day: string, time: string) => {
    setOver(null);
    const moved = e.dataTransfer.getData(IDEA_MOVE_TYPE);
    const listed = e.dataTransfer.getData(IDEA_DRAG_TYPE);
    const post = dragging;
    setDragging(null);
    setError(null);
    if (moved || listed) {
      e.preventDefault();
      if (day < today) { setError("That day has already passed."); return; }
      if (listed) { pick.open(listed, day, time); return; }
      start(async () => {
        const r = await pinIdeaToDayAction(moved, day, time);
        if (!r.ok) setError(r.error); else router.refresh();
      });
      return;
    }
    const item = items.find((i) => i.id === post && !i.projected);
    if (!item || !item.canEdit || (item.day === day && item.time === time)) return;
    e.preventDefault();
    start(async () => {
      try { await reschedulePostAction(item.id, new Date(`${day}T${time}:00`).toISOString()); router.refresh(); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not move that post."); }
    });
  };

  return (
    <div className={`overflow-x-auto rounded-xl border border-border bg-surface ${pending ? "opacity-70" : ""}`}>
      {error && <p role="alert" className="border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,minmax(0,1fr))] text-xs">
        <div className="border-b border-border bg-surface-2" />
        {days.map((d, i) => (
          <div key={d.date} className="border-b border-l border-border bg-surface-2 px-2 py-1.5 text-center font-medium text-muted">
            {names[i]} <span className={d.isToday ? "ml-0.5 inline-grid size-5 place-items-center rounded-full bg-accent font-semibold text-accent-fg" : ""}>{d.label}</span>
          </div>
        ))}

        {times.map((time) => (
          <Row key={time}>
            <div className="border-b border-border px-1.5 pt-2 text-right tabular-nums text-muted" title={timezone}>{time}</div>
            {days.map((d) => {
              const here = items.filter((i) => i.day === d.date && i.time === time);
              const slot = slotsByDay[d.date]?.find((s) => s.time === time);
              const key = `${d.date} ${time}`;
              return (
                <div
                  key={key}
                  onDragOver={(e) => { e.preventDefault(); setOver(key); }}
                  onDragLeave={() => setOver((o) => (o === key ? null : o))}
                  onDrop={(e) => drop(e, d.date, time)}
                  className={`min-h-16 space-y-1 border-b border-l border-border p-1 ${over === key ? "bg-accent-soft" : d.isToday ? "bg-accent-soft/20" : ""}`}
                >
                  {here.map((i, n) => {
                    const meta = STATUS_META[i.status];
                    const color = i.projected ? "#a855f7" : meta.color;
                    const box = `block rounded-md border-l-2 px-1.5 py-1 leading-tight hover:bg-surface-2 ${i.projected ? "border border-dashed border-border" : "bg-surface-2"}`;
                    const edge = { borderLeftColor: i.brandColor };
                    const body = (
                      <>
                        <span className="flex items-center gap-1">
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
                          <span className="flex gap-0.5">{i.platforms.slice(0, 3).map((p, k) => <PlatformIcon key={k} platform={p} size={12} />)}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block">{i.title}</span>
                        <span className="mt-0.5 block truncate text-[10px] font-medium" style={{ color: tintedInk(color) }}>{i.action ?? meta.label}</span>
                      </>
                    );
                    return i.projected ? (
                      <button
                        key={`${i.id}-${n}`} type="button" draggable
                        onClick={() => pick.open(i.id, d.date, time)}
                        onDragStart={(e) => { e.dataTransfer.setData(IDEA_MOVE_TYPE, i.id); e.dataTransfer.effectAllowed = "move"; }}
                        className={`${box} w-full cursor-grab text-left`} style={edge}
                        title={`${i.brandName} · forecast, not a booking`}
                      >{body}</button>
                    ) : (
                      <Link
                        key={`${i.id}-${n}`} href={`/posts/${i.id}`} draggable={i.canEdit}
                        onDragStart={() => setDragging(i.id)} onDragEnd={() => setDragging(null)}
                        className={box} style={edge}
                        title={`${i.brandName} · ${meta.label}${i.formats.length ? " · " + i.formats.join(", ") : ""}`}
                      >{body}</Link>
                    );
                  })}
                  {here.length === 0 && slot && (
                    <div className="grid h-full min-h-12 place-items-center rounded-md border border-dashed border-border/70 text-[10px] text-muted" title={[...new Set(slot.channels.map((c) => c.brandName))].join(", ")}>
                      <span className="flex gap-0.5">{slot.channels.slice(0, 4).map((c) => <PlatformIcon key={c.id} platform={c.platform} size={11} />)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}

/** Lets a row's cells join the parent grid. */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}
