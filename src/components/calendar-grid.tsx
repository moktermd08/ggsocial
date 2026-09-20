"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { PlatformIcon } from "./platform-icon";
import { STATUS_META } from "@/lib/format";
import { reschedulePostAction } from "@/server/actions/posts";
import type { PostStatus } from "@/lib/db";

export type CalendarItem = {
  id: string;
  title: string;
  status: PostStatus;
  brandName: string;
  brandColor: string;
  /** Wall-clock day in the display timezone: "YYYY-MM-DD". */
  day: string;
  time: string;
  platforms: string[];
  canEdit: boolean;
};

export function CalendarGrid({
  days, items, timezone,
}: {
  days: { date: string; inMonth: boolean; isToday: boolean; label: string }[];
  items: CalendarItem[];
  timezone: string;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const drop = (day: string) => {
    const item = items.find((i) => i.id === dragging);
    setOver(null);
    setDragging(null);
    if (!item || item.day === day || !item.canEdit) return;
    // Keep the time of day, move the date.
    const iso = new Date(`${day}T${item.time}:00`).toISOString();
    start(() => { void reschedulePostAction(item.id, iso); });
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-surface ${pending ? "opacity-70" : ""}`}>
      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-[11px] font-medium text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-1.5 text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((d) => {
          const dayItems = items.filter((i) => i.day === d.date);
          return (
            <div
              key={d.date}
              onDragOver={(e) => { e.preventDefault(); setOver(d.date); }}
              onDragLeave={() => setOver((o) => (o === d.date ? null : o))}
              onDrop={() => drop(d.date)}
              className={`min-h-28 border-b border-r border-border p-1.5 last:border-r-0 ${
                d.inMonth ? "" : "bg-surface-2/50"
              } ${over === d.date ? "bg-accent-soft" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span className={`text-[11px] ${d.isToday ? "grid size-5 place-items-center rounded-full bg-accent font-semibold text-accent-fg" : "text-muted"}`}>
                  {d.label}
                </span>
                {d.inMonth && (
                  <Link
                    href={`/posts/new?date=${d.date}`}
                    className="text-[11px] text-muted opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100 [div:hover>div>&]:opacity-100"
                  >
                    +
                  </Link>
                )}
              </div>

              <div className="space-y-1">
                {dayItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/posts/${item.id}`}
                    draggable={item.canEdit}
                    onDragStart={() => setDragging(item.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`block rounded-md border-l-2 bg-surface-2 px-1.5 py-1 text-[11px] leading-tight hover:bg-surface ${
                      dragging === item.id ? "opacity-40" : ""
                    }`}
                    style={{ borderLeftColor: item.brandColor }}
                    title={`${item.brandName} · ${STATUS_META[item.status].label} · ${item.time} ${timezone}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="tabular-nums text-muted">{item.time}</span>
                      <div className="flex -space-x-0.5">
                        {item.platforms.slice(0, 3).map((p, i) => <PlatformIcon key={i} platform={p} size={11} />)}
                      </div>
                    </div>
                    <p className="mt-0.5 line-clamp-2">{item.title}</p>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
