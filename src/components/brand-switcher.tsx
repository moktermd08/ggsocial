"use client";
import { useState, useTransition, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Layers, Plus } from "lucide-react";
import Link from "next/link";
import { setScopeAction } from "@/server/actions/scope";

export type BrandOption = { id: string; name: string; color: string; role: string };

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
        ) : (
          <span
            className="size-5 shrink-0 rounded-md"
            style={{ background: active?.color ?? "linear-gradient(135deg,#6366f1,#ec4899)" }}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{isMaster ? "Master" : active?.name ?? "All brands"}</span>
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
            <span className="flex-1">All brands</span>
            {value === "all" && <Check className="size-4 text-accent" />}
          </button>
          <div className="max-h-72 overflow-y-auto border-t border-border">
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => pick(b.id)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="size-5 shrink-0 rounded-md" style={{ background: b.color }} />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {value === b.id && <Check className="size-4 shrink-0 text-accent" />}
              </button>
            ))}
          </div>
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
