"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Loader2, MousePointerClick, Plus } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { createPostLinksAction } from "@/server/actions/links";
import type { DestinationOption } from "@/lib/destinations";

/**
 * Picks a saved destination. Links issued from one keep following it, so a
 * URL fixed there is fixed in every post. "Type a URL" issues a one-off.
 */
export function DestinationPicker({ options, value, onPick }: {
  options: DestinationOption[];
  value: string | null;
  onPick: (d: DestinationOption | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onPick(options.find((o) => o.id === e.target.value) ?? null)}
      className="!py-1 !text-sm"
      aria-label="Saved destination"
    >
      <option value="">Type a URL, or pick a saved destination…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}{o.fromMaster ? " (master)" : ""}</option>
      ))}
    </select>
  );
}

export type PanelLink = {
  id: string;
  code: string;
  url: string;
  label: string;
  destination: string;
  platform: string | null;
  handle: string | null;
  clickCount: number;
  uniqueCount: number;
};

/**
 * Tracked links for one post, one per channel.
 *
 * The point of issuing a separate link per channel is that clicks then answer
 * "which platform sent them", which raw impressions never can. Creating them
 * needs a saved post, because a link has to hang off something.
 */
export function LinkPanel({
  brandId, postId, campaign, channels, existing, canEdit, destinations = [],
}: {
  /** Saved destinations this brand can issue from. */
  destinations?: DestinationOption[];
  brandId: string;
  postId: string | null;
  campaign: string | null;
  /** The channels this post is going to — the link set is built from these. */
  channels: { id: string; platform: string; handle: string }[];
  existing: PanelLink[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [label, setLabel] = useState("");
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(url: string, id: string) {
    navigator.clipboard?.writeText(url);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1500);
  }

  function create() {
    setError(null);
    startTransition(async () => {
      try {
        await createPostLinksAction({
          brandId,
          postId,
          destination,
          label,
          campaign,
          destinationId,
          channelIds: channels.map((c) => c.id),
        });
        setDestination("");
        setLabel("");
        setDestinationId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create the links.");
      }
    });
  }

  const totalClicks = existing.reduce((n, l) => n + l.clickCount, 0);

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Link2 className="size-4" /> Tracked links</span>}
        subtitle={
          existing.length === 0
            ? "One short link per channel, so clicks say where they came from."
            : `${existing.length} link${existing.length === 1 ? "" : "s"} · ${totalClicks.toLocaleString()} click${totalClicks === 1 ? "" : "s"}`
        }
      />

      <div className="space-y-3 p-3">
        {existing.map((l) => (
          <div key={l.id} className="rounded-lg border border-border bg-surface-2 p-2">
            <div className="flex items-center gap-1.5 text-xs">
              {l.platform ? <PlatformIcon platform={l.platform} size={14} /> : <Link2 className="size-3.5 text-muted" />}
              <span className="min-w-0 flex-1 truncate font-medium">{l.handle ?? l.label}</span>
              <span className="flex items-center gap-1 tabular-nums text-muted" title={`${l.uniqueCount} unique`}>
                <MousePointerClick className="size-3" /> {l.clickCount}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-1 text-[11px]">{l.url}</code>
              <button
                type="button"
                onClick={() => copy(l.url, l.id)}
                className={buttonClass("subtle", "sm")}
                title="Copy the short link"
              >
                {copied === l.id ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
              </button>
            </div>
          </div>
        ))}

        {!postId && (
          <p className="rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-xs text-muted">
            Save the post first — a tracked link has to hang off something.
          </p>
        )}

        {postId && canEdit && (
          <div className="space-y-2 border-t border-border pt-3">
            <Field label="Destination" hint="Where the click should land. The scheme is optional.">
              <DestinationPicker
                options={destinations}
                value={destinationId}
                onPick={(d) => {
                  setDestinationId(d?.id ?? null);
                  setDestination(d?.url ?? "");
                  if (d && !label) setLabel(d.name);
                }}
              />
              <input
                value={destination}
                onChange={(e) => { setDestination(e.target.value); setDestinationId(null); }}
                placeholder="moksy.ai/discovery-template"
                className="mt-1 !py-1 !text-sm"
              />
            </Field>
            <Field label="Label" hint="Optional — what this link is for.">
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="!py-1 !text-sm" />
            </Field>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              type="button"
              onClick={create}
              disabled={pending || !destination.trim() || channels.length === 0}
              className={`${buttonClass("primary", "sm")} w-full`}
              title={channels.length === 0 ? "Pick the channels this post is going to first" : undefined}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {channels.length === 0
                ? "Pick channels first"
                : `Issue ${channels.length} link${channels.length === 1 ? "" : "s"}`}
            </button>
            <p className="text-[11px] text-muted">
              UTMs are built when the link is followed, so fixing a campaign name later never means reissuing
              links that are already posted.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
