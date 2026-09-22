"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Archive, Check, Copy, Link2, Loader2, MousePointerClick, Plus, RotateCcw, Search } from "lucide-react";
import { Card, Field, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { relativeTime, truncate } from "@/lib/format";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import { archiveLinkAction, createPostLinksAction } from "@/server/actions/links";
import type { ActionResult } from "@/lib/action-result";
import type { DestinationOption } from "@/lib/destinations";
import { DestinationPicker } from "./link-panel";

export type LinkTableRow = {
  id: string;
  code: string;
  url: string;
  label: string;
  destination: string;
  brandId: string;
  brandName: string;
  brandColor: string;
  platform: string | null;
  handle: string | null;
  post: { id: string; title: string } | null;
  utmCampaign: string | null;
  clickCount: number;
  uniqueCount: number;
  lastClickAt: string | null;
  archived: boolean;
};

export type LinkTableBrand = {
  id: string;
  name: string;
  channels: { id: string; platform: string; handle: string }[];
  /** Saved destinations links in this brand can be issued from. */
  destinations: DestinationOption[];
};

/** Every tracked link, busiest first, plus somewhere to mint a new one. */
export function LinkTable({
  rows, brands, canEdit, now,
}: {
  rows: LinkTableRow[];
  brands: LinkTableBrand[];
  canEdit: boolean;
  /** Server clock, so client and server agree about "2 hours ago". */
  now: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showArchived && r.archived) return false;
      if (!q) return true;
      return [r.label, r.destination, r.code, r.brandName, r.handle, r.post?.title, r.utmCampaign]
        .filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, query, showArchived]);

  function run(work: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await work();
        if (!res.ok) { setError(res.error); return; }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    });
  }

  function copy(url: string, id: string) {
    navigator.clipboard?.writeText(url);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by label, destination, campaign or post…"
            className="!w-full !py-1.5 !pl-8 !text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={buttonClass(showArchived ? "primary" : "subtle", "sm")}
        >
          <Archive className="size-3.5" /> Retired
        </button>
        {canEdit && brands.length > 0 && (
          <button type="button" onClick={() => setAdding((v) => !v)} className={buttonClass(adding ? "primary" : "subtle", "sm")}>
            <Plus className="size-3.5" /> New link
          </button>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted" />}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      {adding && canEdit && <NewLinkForm brands={brands} pending={pending} onRun={run} onDone={() => setAdding(false)} />}

      {visible.length === 0 ? (
        <Card>
          <p className="px-4 py-12 text-center text-sm text-muted">
            {rows.length === 0
              ? "No tracked links yet. Open a post and issue one per channel, or mint a standalone one above."
              : "Nothing matches that search."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">Link</th>
                <th className="w-40 px-3 py-2 font-semibold">Goes to</th>
                <th className="w-36 px-3 py-2 font-semibold">From</th>
                <th className="w-24 px-3 py-2 text-right font-semibold">Clicks</th>
                <th className="w-24 px-3 py-2 text-right font-semibold" title="Distinct visitors, counted per day">People</th>
                <th className="w-28 px-3 py-2 font-semibold">Last</th>
                <th className="w-16 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className={`border-b border-border align-middle ${r.archived ? "opacity-55" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {r.platform ? <PlatformIcon platform={r.platform} size={16} /> : <Link2 className="size-4 text-muted" />}
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">/l/{r.code}</code>
                      <button
                        type="button"
                        onClick={() => copy(r.url, r.id)}
                        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
                        title="Copy the short link"
                      >
                        {copied === r.id ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{r.label}</p>
                  </td>

                  <td className="px-3 py-2">
                    <a
                      href={r.destination}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate text-xs underline hover:text-text"
                      title={r.destination}
                    >
                      {r.destination.replace(/^https?:\/\//, "")}
                    </a>
                  </td>

                  <td className="px-3 py-2">
                    <span
                      className="inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ borderColor: tintedBorder(r.brandColor), background: tintedSurface(r.brandColor), color: tintedInk(r.brandColor) }}
                    >
                      {r.brandName}
                    </span>
                    {r.post && (
                      <Link href={`/posts/${r.post.id}`} className="mt-0.5 block truncate text-[11px] text-muted underline hover:text-text">
                        {truncate(r.post.title || "the post", 28)}
                      </Link>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {r.clickCount > 0 ? r.clickCount.toLocaleString() : <span className="text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {r.uniqueCount > 0 ? r.uniqueCount.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-muted">
                    {r.lastClickAt ? relativeTime(r.lastClickAt, now) : "—"}
                  </td>

                  <td className="px-3 py-2 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => archiveLinkAction(r.id))}
                        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
                        title={r.archived ? "Put it back in service" : "Retire — the code stops redirecting, the clicks stay"}
                      >
                        {r.archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <MousePointerClick className="size-3" />
        Bots and link-preview fetches are recorded but never counted — every platform loads a URL the moment you
        paste it, and those are not readers.
      </p>
    </div>
  );
}

/** A link with no post behind it — a bio link, a QR code, a DM. */
function NewLinkForm({
  brands, pending, onRun, onDone,
}: {
  brands: LinkTableBrand[];
  pending: boolean;
  onRun: (work: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [destination, setDestination] = useState("");
  const [label, setLabel] = useState("");
  const [campaign, setCampaign] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [destinationId, setDestinationId] = useState<string | null>(null);

  const brand = brands.find((b) => b.id === brandId);

  return (
    <Card>
      <form
        className="space-y-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onRun(async () => {
            const res = await createPostLinksAction({ brandId, destination, label, campaign, channelIds, destinationId });
            if (res.ok) {
              setDestination(""); setLabel(""); setCampaign(""); setChannelIds([]); setDestinationId(null);
              onDone();
            }
            return res;
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Brand">
            <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setChannelIds([]); setDestinationId(null); }} className="!py-1 !text-sm">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Destination">
            <DestinationPicker
              options={brand?.destinations ?? []}
              value={destinationId}
              onPick={(d) => {
                setDestinationId(d?.id ?? null);
                setDestination(d?.url ?? "");
                if (d && !label) setLabel(d.name);
                if (d?.utmCampaign) setCampaign(d.utmCampaign);
              }}
            />
            <input
              value={destination}
              onChange={(e) => { setDestination(e.target.value); setDestinationId(null); }}
              placeholder="moksy.ai/pricing"
              className="mt-1 !py-1 !text-sm"
            />
          </Field>
          <Field label="Label">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="!py-1 !text-sm" />
          </Field>
          <Field label="Campaign" hint="Becomes utm_campaign.">
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} className="!py-1 !text-sm" />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">
            Channels — one link each. Pick none for a single untracked-by-platform link.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {brand?.channels.map((c) => {
              const on = channelIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannelIds((ids) => on ? ids.filter((i) => i !== c.id) : [...ids, c.id])}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                    on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"
                  }`}
                >
                  <PlatformIcon platform={c.platform} size={14} /> {c.handle}
                </button>
              );
            })}
            {brand?.channels.length === 0 && <span className="text-xs text-muted">No channels on this brand yet.</span>}
          </div>
        </div>

        <button type="submit" disabled={pending || !destination.trim() || !brandId} className={buttonClass("primary", "sm")}>
          <Plus className="size-3.5" />
          Issue {channelIds.length > 0 ? `${channelIds.length} link${channelIds.length === 1 ? "" : "s"}` : "one link"}
        </button>
      </form>
    </Card>
  );
}
