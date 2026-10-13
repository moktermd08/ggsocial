"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { PlatformIcon } from "./platform-icon";
import { STATUS_META } from "@/lib/format";
import { tintedInk } from "@/lib/color";
import { IDEA_DRAG_TYPE, useIdeaPick } from "./idea-pick";
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
  /** The formats going out at this time, as labels: "Carousel", "Reel". */
  formats: string[];
  /** What it needs from a person, or null. */
  action: string | null;
  /** An idea on the day the content writer would book it, not a post. */
  projected?: boolean;
  href?: string;
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
  const pick = useIdeaPick();

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
              onDrop={(e) => {
                const ideaId = e.dataTransfer.getData(IDEA_DRAG_TYPE);
                if (ideaId) { e.preventDefault(); setOver(null); if (d.date >= new Date().toISOString().slice(0, 10)) pick.open(ideaId, d.date); return; }
                drop(d.date);
              }}
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
                {dayItems.map((item, n) => (
                  <Link
                    key={`${item.id}-${item.time}-${n}`}
                    href={item.href ?? `/posts/${item.id}`}
                    onClick={(e) => { if (item.projected) { e.preventDefault(); pick.open(item.id, item.day); } }}
                    draggable={item.canEdit && !item.projected}
                    onDragStart={() => setDragging(item.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`block rounded-md border-l-2 px-1.5 py-1 text-[11px] leading-tight hover:bg-surface ${
                      item.projected ? "border border-dashed border-border bg-transparent" : "bg-surface-2"
                    } ${dragging === item.id ? "opacity-40" : ""}`}
                    style={{ borderLeftColor: item.brandColor }}
                    title={item.projected ? `${item.brandName} · ${item.action} · the writer would book this around ${item.time} ${timezone}. A forecast, not a booking.` : `${item.brandName} · ${STATUS_META[item.status].label}${item.formats.length ? " · " + item.formats.join(", ") : ""} · ${item.time} ${timezone}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: item.projected ? "#a855f7" : STATUS_META[item.status].color }} />
                      <span className="tabular-nums text-muted">{item.time}</span>
                      <div className="flex gap-0.5">
                        {item.platforms.slice(0, 3).map((p, i) => <PlatformIcon key={i} platform={p} size={13} />)}
                      </div>
                    </div>
                    <p className="mt-0.5 line-clamp-2">{item.title}</p>
                    {item.formats.length > 0 && <p className="mt-0.5 truncate text-[10px] text-muted">{item.formats.join(" · ")}</p>}
                    <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: tintedInk(item.projected ? "#a855f7" : STATUS_META[item.status].color) }}>
                      {item.action ?? STATUS_META[item.status].label}
                    </p>
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
