import { Building2, Layers } from "lucide-react";
import Link from "next/link";
import { requireUser, getMyBrands } from "@/lib/auth";
import { getBrandChannels } from "@/server/queries";
import { Card, EmptyState, LinkButton, PageHeader, Badge } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { BrandMark } from "@/components/brand-mark";

/** How much of the brand book is filled in — nudges people to finish it. */
function completeness(b: { tagline: string | null; description: string | null; logoUrl: string | null;
  palette: unknown[]; voice: string | null; audience: string | null; valueProps: unknown[]; links: unknown[] }) {
  const checks = [
    b.tagline, b.description, b.logoUrl, b.voice, b.audience,
    b.palette.length ? "y" : null, b.valueProps.length ? "y" : null, b.links.length ? "y" : null,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export default async function BrandsPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const channels = await getBrandChannels(brands.map((b) => b.id));

  return (
    <>
      <PageHeader
        icon={Building2}
        title="Brands & team"
        subtitle="One brand per company or project. Channels, media, calendar, permissions and the brand book are scoped to it."
        action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>}
      />

      <Link
        href="/brands/master"
        className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-text text-surface"><Layers className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Master brand book</span>
          <span className="block text-xs text-muted">
            House voice, words to avoid, emoji policy, CTA and visual guidance — written once, followed by {brands.filter((b) => b.bookDefaultsId).length} of {brands.length} brands.
          </span>
        </span>
      </Link>

      {brands.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No brands yet"
            body="Add the companies you manage — you can bulk-add all ten and fill in channels as you go."
            action={<LinkButton href="/brands/new" variant="primary">Add your first brand</LinkButton>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => {
            const mine = channels.filter((c) => c.brandId === b.id);
            const pct = completeness(b);
            return (
              <Link
                key={b.id}
                href={`/brands/${b.id}`}
                className="flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2.5">
                  <BrandMark brand={b} size={36} className="rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{b.name}</p>
                    <p className="truncate text-[11px] text-muted">{b.tagline ?? b.timezone}</p>
                  </div>
                  {b.bookDefaultsId && <Badge><Layers className="size-3" /> Master book</Badge>}
                  <Badge>{b.role}</Badge>
                </div>

                {b.palette.length > 0 && (
                  <div className="mt-3 flex gap-1">
                    {b.palette.slice(0, 6).map((c) => (
                      <span key={c.hex} className="size-3.5 rounded" style={{ background: c.hex }} title={`${c.name} · ${c.hex}`} />
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-1">
                  {mine.length === 0 ? (
                    <span className="text-xs text-muted">No channels yet</span>
                  ) : (
                    mine.map((c) => (
                      <span key={c.id} className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
                        <PlatformIcon platform={c.platform} size={13} variant="glyph" /> {c.handle}
                      </span>
                    ))
                  )}
                </div>

                <div className="mt-auto pt-3">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span>Brand profile</span>
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 3)}%` }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
