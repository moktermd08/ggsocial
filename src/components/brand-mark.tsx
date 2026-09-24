import { readableOn } from "@/lib/color";

/** The bits of a brand profile needed to draw its mark. */
export type BrandMarkSource = { name: string; color: string; logoUrl?: string | null; logoIconUrl?: string | null };

/**
 * A brand's avatar, pulled from its profile: the icon mark if one is set,
 * else the full logo, else its initials on the brand colour.
 */
export function BrandMark({ brand, size = 20, className = "" }: { brand: BrandMarkSource; size?: number; className?: string }) {
  const src = brand.logoIconUrl || brand.logoUrl;
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-md ${className}`}
      style={{
        width: size,
        height: size,
        ...(src ? { background: "var(--surface-2)" } : { background: brand.color, color: readableOn(brand.color) }),
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-contain" />
      ) : (
        <span className="font-bold leading-none" style={{ fontSize: Math.max(8, Math.round(size * 0.4)) }}>
          {brand.name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}
