"use client";

import { useRef } from "react";
import { X } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";

type Chan = { id: string; platform: string; handle: string };

const VISIBLE = 4;

/**
 * A brand's channels as chips: the first few inline, the rest behind a
 * "+N more" button that opens a modal. Lives inside a card-wide link, so every
 * interaction stops the click from navigating.
 */
export function BrandChannelChips({ brandName, channels }: { brandName: string; channels: Chan[] }) {
  const ref = useRef<HTMLDialogElement>(null);

  if (channels.length === 0) return <span className="text-xs text-muted">No channels yet</span>;

  const shown = channels.slice(0, VISIBLE);
  const extra = channels.length - shown.length;

  return (
    <>
      {shown.map((c) => <Chip key={c.id} c={c} />)}
      {extra > 0 && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); ref.current?.showModal(); }}
          className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          +{extra} more
        </button>
      )}
      <dialog
        ref={ref}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.target === ref.current) ref.current?.close(); // backdrop click
        }}
        className="m-auto w-[min(32rem,92vw)] rounded-xl border border-border bg-surface p-0 text-text backdrop:bg-black/40"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">{brandName} · {channels.length} channels</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => ref.current?.close()}
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex max-h-[60vh] flex-wrap gap-1.5 overflow-y-auto p-4">
          {channels.map((c) => <Chip key={c.id} c={c} />)}
        </div>
      </dialog>
    </>
  );
}

function Chip({ c }: { c: Chan }) {
  return (
    <span className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
      <PlatformIcon platform={c.platform} size={13} variant="glyph" /> {c.handle}
    </span>
  );
}
