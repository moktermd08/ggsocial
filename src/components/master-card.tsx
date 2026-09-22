import Link from "next/link";
import { Layers, MessageSquare } from "lucide-react";
import { Badge } from "./ui";
import { STATUS_META, relativeTime, truncate } from "@/lib/format";
import type { MasterSummary } from "@/server/masters";

type BrandChip = { id: string; name: string; color: string };

/** A master in the list, with one dot per brand copy showing where each one is. */
export function MasterCard({ master, brands }: { master: MasterSummary; brands: Map<string, BrandChip> }) {
  const waiting = master.copies.filter((c) => c.pending.length > 0).length;
  return (
    <Link
      href={`/posts/master/${master.id}`}
      className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
          <Layers className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>Master</Badge>
            {master.campaign && <Badge>{master.campaign}</Badge>}
            {waiting > 0 && <Badge color="#d97706">{waiting} brand{waiting === 1 ? "" : "s"} behind</Badge>}
          </div>
          <p className="mt-1.5 text-sm font-medium">{master.title || truncate(master.body, 60) || "Untitled"}</p>
          {master.title && master.body && <p className="mt-0.5 text-xs text-muted">{truncate(master.body, 100)}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {master.copies.map((c) => {
              const b = brands.get(c.brandId);
              const meta = STATUS_META[c.status];
              return (
                <span
                  key={c.postId}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px]"
                  title={`${b?.name ?? "Another brand"} · ${meta.label}${c.customised.length ? " · customised" : ""}`}
                >
                  <span className="size-2 rounded-full" style={{ background: b?.color ?? "#888" }} />
                  <span className="max-w-24 truncate">{b?.name ?? "Other"}</span>
                  <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                </span>
              );
            })}
            {master.copies.length === 0 && <span className="text-xs text-muted">No brand copies yet</span>}
          </div>
          <p className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
            Updated {relativeTime(master.updatedAt)}
            {master.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" /> {master.commentCount}</span>
            )}
          </p>
        </div>
      </div>
    </Link>
  );
}
