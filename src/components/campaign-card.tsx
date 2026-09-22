import Link from "next/link";
import { CalendarRange, Layers, Megaphone } from "lucide-react";
import { Badge } from "./ui";
import { CAMPAIGN_STATUS_META } from "@/lib/campaigns";
import { truncate } from "@/lib/format";
import type { CampaignSummary } from "@/server/campaigns";

type BrandChip = { id: string; name: string; color: string };

function dates(start: string | null, end: string | null) {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return null;
}

export function CampaignCard({ campaign: c, brands, showBrand }: {
  campaign: CampaignSummary; brands: Map<string, BrandChip>; showBrand?: boolean;
}) {
  const meta = CAMPAIGN_STATUS_META[c.status];
  const brand = c.brandId ? brands.get(c.brandId) : undefined;
  const when = dates(c.startDate, c.endDate);
  const behind = c.brandId ? c.pending.length : c.copies.filter((x) => x.pending.length).length;

  return (
    <Link href={`/campaigns/${c.id}`} className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"
          style={brand ? { background: `${brand.color}22`, color: brand.color } : undefined}
        >
          {c.brandId ? <Megaphone className="size-5" /> : <Layers className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {!c.brandId && <Badge>Master</Badge>}
            {showBrand && brand && (
              <Badge color={brand.color}>
                <span className="size-1.5 rounded-full" style={{ background: brand.color }} /> {brand.name}
              </Badge>
            )}
            <Badge color={meta.color}>{meta.label}</Badge>
            {c.masterId && <Badge><Layers className="size-3" /> From master</Badge>}
            {behind > 0 && (
              <Badge color="#d97706">
                {c.brandId ? `${behind} master change${behind === 1 ? "" : "s"}` : `${behind} brand${behind === 1 ? "" : "s"} behind`}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm font-medium">{c.name}</p>
          {(c.keyMessage || c.objective) && (
            <p className="mt-0.5 text-xs text-muted">{truncate(c.keyMessage || c.objective || "", 110)}</p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {when && <span className="inline-flex items-center gap-1"><CalendarRange className="size-3" /> {when}</span>}
            <span>{c.posts} post{c.posts === 1 ? "" : "s"} · {c.published} published</span>
            {!c.brandId && (
              <span className="inline-flex items-center gap-1">
                {c.copies.map((x) => (
                  <span key={x.id} className="size-2 rounded-full" style={{ background: brands.get(x.brandId)?.color ?? "#888" }} title={brands.get(x.brandId)?.name} />
                ))}
                {c.copies.length === 0 ? "no brands yet" : `${c.copies.length} brand${c.copies.length === 1 ? "" : "s"}`}
              </span>
            )}
          </p>
        </div>
      </div>
    </Link>
  );
}
