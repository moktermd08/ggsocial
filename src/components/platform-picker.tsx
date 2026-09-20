"use client";
import { useMemo, useState } from "react";
import { Search, Zap } from "lucide-react";
import { buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { CATEGORY_LABELS, CATEGORY_ORDER, type PlatformCategory } from "@/lib/platforms/types";
import type { PlatformMeta } from "@/lib/platforms/meta";

/**
 * Channel chooser for a roster of ~100 platforms: search first, grouped second,
 * with auto-publishing channels always ahead of manual-only ones.
 */
export function PlatformPicker({
  platforms, onPick, onCancel,
}: {
  platforms: PlatformMeta[];
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [liveOnly, setLiveOnly] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = platforms.filter((p) => {
      if (liveOnly && p.manualOnly) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.blurb.toLowerCase().includes(q) ||
        CATEGORY_LABELS[p.category].toLowerCase().includes(q)
      );
    });
    return CATEGORY_ORDER
      .map((category: PlatformCategory) => ({
        category,
        items: matches
          .filter((p) => p.category === category)
          .sort((a, b) => Number(a.manualOnly) - Number(b.manualOnly) || a.name.localeCompare(b.name)),
      }))
      .filter((g) => g.items.length > 0);
  }, [platforms, query, liveOnly]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 100+ channels — telegram, newsletter, maps, Bangladesh…"
            className="!w-full !pl-8 !py-1.5 !text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => setLiveOnly((v) => !v)}
          className={buttonClass(liveOnly ? "primary" : "subtle", "sm")}
          title="Only channels ggsocial can publish to by itself"
        >
          <Zap className="size-3.5" /> Auto-publish only
        </button>
        <button type="button" onClick={onCancel} className={buttonClass("ghost", "sm")}>Cancel</button>
      </div>

      <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g.category}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {CATEGORY_LABELS[g.category]}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p.id)}
                  title={`${p.blurb}${p.manualOnly ? " (manual — no write API)" : ""}`}
                  className={`${buttonClass("subtle", "sm")} ${p.manualOnly ? "opacity-70" : ""}`}
                >
                  <PlatformIcon platform={p.id} size={14} />
                  {p.name}
                  {!p.manualOnly && <Zap className="size-3 text-ok" />}
                </button>
              ))}
            </div>
          </div>
        ))}
        {total === 0 && (
          <p className="py-6 text-center text-sm text-muted">
            Nothing matches “{query}”.{" "}
            <button type="button" className="underline" onClick={() => { setQuery(""); setLiveOnly(false); }}>Clear filters</button>
          </p>
        )}
      </div>

      <p className="text-[11px] text-muted">
        <Zap className="inline size-3 text-ok" /> publishes by itself once connected. The rest are prepared,
        scheduled and queued with copy-ready blocks for a person to post — those platforms have no write API.
      </p>
    </div>
  );
}
