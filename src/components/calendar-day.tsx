"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlatformIcon } from "./platform-icon";
import { IDEA_DRAG_TYPE, IDEA_MOVE_TYPE, PickEntry, useIdeaPick } from "./idea-pick";
import { STATUS_META } from "@/lib/format";
import { tintedInk } from "@/lib/color";
import { pinIdeaToDayAction } from "@/server/actions/ideas";
import type { CalendarItem } from "./calendar-grid";

/** A time a channel posts at on this day. */
export type DaySlot = { time: string; channels: { id: string; platform: string; brandName: string; brandColor: string }[] };

/**
 * One day as its posting slots: each time a channel may post, with what is
 * booked there, the ideas forecast into it, and the slots still open. Drop an
 * idea on a slot to pin it to that time.
 */
export function CalendarDay({ day, items, slots, timezone }: { day: string; items: CalendarItem[]; slots: DaySlot[]; timezone: string }) {
  const router = useRouter();
  const pick = useIdeaPick();
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const times = [...new Set([...slots.map((s) => s.time), ...items.map((i) => i.time)])].sort();
  if (times.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No channel posts on this day, and nothing is planned for it.</p>;
  }

  const drop = (e: React.DragEvent, time: string) => {
    e.stopPropagation(); // a surrounding day (the agenda) must not also pin it to the day alone
    setOver(null);
    const moved = e.dataTransfer.getData(IDEA_MOVE_TYPE);
    const listed = e.dataTransfer.getData(IDEA_DRAG_TYPE);
    if (!moved && !listed) return;
    e.preventDefault();
    setError(null);
    if (listed) { pick.open(listed, day, time); return; }
    start(async () => {
      const r = await pinIdeaToDayAction(moved, day, time);
      if (!r.ok) setError(r.error); else router.refresh();
    });
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface ${pending ? "opacity-70" : ""}`}>
      {error && <p role="alert" className="border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      <ul className="divide-y divide-border">
        {times.map((time) => {
          const slot = slots.find((s) => s.time === time);
          const here = items.filter((i) => i.time === time);
          return (
            <li
              key={time}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(IDEA_MOVE_TYPE) || e.dataTransfer.types.includes(IDEA_DRAG_TYPE)) { e.preventDefault(); setOver(time); } }}
              onDragLeave={() => setOver((o) => (o === time ? null : o))}
              onDrop={(e) => drop(e, time)}
              className={`flex gap-3 px-3 py-2.5 ${over === time ? "bg-accent-soft" : ""}`}
            >
              <div className="w-16 shrink-0 pt-1">
                <p className="text-sm font-medium tabular-nums" title={timezone}>{time}</p>
                {slot && <div className="mt-1 flex flex-wrap gap-0.5">{slot.channels.slice(0, 6).map((c) => <PlatformIcon key={c.id} platform={c.platform} size={14} />)}</div>}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {here.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted">
                    Open slot{slot ? ` · ${[...new Set(slot.channels.map((c) => c.brandName))].slice(0, 3).join(", ")}${new Set(slot.channels.map((c) => c.brandName)).size > 3 ? " …" : ""}` : ""}. Drop an idea here.
                  </p>
                ) : here.map((i, n) => {
                  const meta = STATUS_META[i.status];
                  const edge = { borderLeft: `3px solid ${i.brandColor}` };
                  const inner = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{i.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {i.brandName}{i.projected ? " · forecast, click to put it on the calendar" : i.formats.length ? ` · ${i.formats.join(", ")}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-0.5 pt-0.5">{i.platforms.slice(0, 5).map((p, k) => <PlatformIcon key={k} platform={p} size={16} />)}</div>
                      <span className="w-28 shrink-0 text-right text-[11px] font-medium" style={{ color: tintedInk(i.projected ? "#a855f7" : meta.color) }}>{i.action ?? meta.label}</span>
                    </>
                  );
                  const box = "flex items-start gap-3 rounded-lg border border-border px-3 py-2 hover:bg-surface-2";
                  return i.projected
                    ? <PickEntry key={`${i.id}-${n}`} ideaId={i.id} day={day} className={`${box} border-dashed`} style={edge}>{inner}</PickEntry>
                    : <Link key={`${i.id}-${n}`} href={`/posts/${i.id}`} className={box} style={edge}>{inner}</Link>;
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
