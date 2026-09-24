"use client";
import { useState, useTransition, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Layers, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { setScopeAction } from "@/server/actions/scope";
import { BrandMark } from "@/components/brand-mark";

/** What the switcher shows for each brand — pulled from its brand profile. */
export type BrandOption = {
  id: string;
  name: string;
  color: string;
  role: string;
  logoUrl: string | null;
  logoIconUrl: string | null;
  tagline: string | null;
  timezone: string;
  channelCount: number;
};

export function BrandSwitcher({ brands, value }: { brands: BrandOption[]; value: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = brands.find((b) => b.id === value);
  const isMaster = value === "master";

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    start(() => { void setScopeAction(id); });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left text-sm hover:bg-surface-2"
        style={{ opacity: pending ? 0.6 : 1 }}
      >
        {isMaster ? (
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-text text-surface"><Layers className="size-3" /></span>
        ) : active ? (
          <BrandMark brand={active} />
        ) : (
          <span className="size-5 shrink-0 rounded-md" style={{ background: "linear-gradient(135deg,#6366f1,#ec4899)" }} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{isMaster ? "Master" : active?.name ?? "All brands"}</span>
          {active?.tagline && <span className="block truncate text-[11px] font-normal text-muted">{active.tagline}</span>}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <button
            onClick={() => pick("master")}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-surface-2"
            title="The master copies every brand works from"
          >
            <span className="grid size-5 place-items-center rounded-md bg-text text-surface"><Layers className="size-3" /></span>
            <span className="flex-1">Master</span>
            {isMaster && <Check className="size-4 text-accent" />}
          </button>
          <button
            onClick={() => pick("all")}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-surface-2"
          >
            <span className="size-5 rounded-md" style={{ background: "linear-gradient(135deg,#6366f1,#ec4899)" }} />
            <span className="min-w-0 flex-1">
              <span className="block">All brands</span>
              <span className="block text-[11px] text-muted">
                {brands.length} brand{brands.length === 1 ? "" : "s"} · {brands.reduce((n, b) => n + b.channelCount, 0)} channels
              </span>
            </span>
            {value === "all" && <Check className="size-4 text-accent" />}
          </button>
          <div className="max-h-72 overflow-y-auto border-t border-border">
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => pick(b.id)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-surface-2"
                title={b.tagline ?? undefined}
              >
                <BrandMark brand={b} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{b.name}</span>
                  <span className="block truncate text-[11px] text-muted">{b.tagline ?? b.timezone}</span>
                  <span className="block text-[10px] text-muted">
                    {b.channelCount} channel{b.channelCount === 1 ? "" : "s"} · {b.role}
                  </span>
                </span>
                {value === b.id && <Check className="size-4 shrink-0 text-accent" />}
              </button>
            ))}
          </div>
          {active && (
            <Link
              href={`/brands/${active.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-t border-border px-2.5 py-2 text-sm text-muted hover:bg-surface-2"
            >
              <Settings2 className="size-4" /> {active.name} profile
            </Link>
          )}
          <Link
            href="/brands/new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-border px-2.5 py-2 text-sm text-muted hover:bg-surface-2"
          >
            <Plus className="size-4" /> Add a brand
          </Link>
        </div>
      )}
    </div>
  );
}
