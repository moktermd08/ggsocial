import { platformOrNull } from "@/lib/platforms";
import { PLATFORM_GLYPHS } from "@/lib/platforms/glyphs";
import { luminance, readableOn } from "@/lib/color";

/**
 * Short marks for the handful of platforms with no authentic logo available
 * (see scripts/generate-platform-icons.mjs). A deliberate wordmark reads as a
 * choice; a near-miss logo borrowed from another company reads as a bug.
 */
const WORDMARKS: Record<string, string> = {
  beehiiv: "bh", betalist: "BL", bikroy: "bk", capterra: "Cp", circle: "Ci",
  clutch: "Cl", convertkit: "Kit", craigslist: "CL", daraz: "dz", douyin: "DY",
  klaviyo: "Kl", mighty_networks: "MN", olx: "OLX", onesignal: "1S",
  restream: "Re", saashub: "SH", sharechat: "SC", skool: "Sk",
};

function wordmarkFor(id: string, name: string) {
  return WORDMARKS[id] ?? (name.replace(/[^A-Za-z]/g, "").slice(0, 2) || "?");
}

/**
 * A platform's real brand mark on an app-icon tile in its own brand colour.
 *
 * `glyph` drops the tile and paints just the mark — for dense rows where a
 * grid of coloured squares would fight the surrounding text.
 */
export function PlatformIcon({
  platform,
  size = 20,
  variant = "tile",
  className = "",
}: {
  platform: string;
  size?: number;
  variant?: "tile" | "glyph";
  className?: string;
}) {
  const p = platformOrNull(platform);
  const name = p?.name ?? platform;
  const brand = p?.color ?? "#71717a";
  const path = PLATFORM_GLYPHS[platform];

  if (variant === "glyph") {
    // On its own the mark keeps the brand hex. Near-black brands (X, TikTok,
    // Threads, GitHub, Notion) have no hue worth keeping and a blend still sinks
    // into a dark page, so they take the text colour outright: white on dark,
    // black on light — which is how those companies draw their own marks.
    const ink = luminance(brand) < 0.03 ? "var(--text)" : `color-mix(in oklab, ${brand} 78%, var(--text))`;
    if (!path) {
      return (
        <span
          role="img"
          aria-label={name}
          title={name}
          className={`inline-flex shrink-0 items-center justify-center font-bold tabular-nums ${className}`}
          style={{ width: size, height: size, color: ink, fontSize: size * 0.46, letterSpacing: "-0.03em" }}
        >
          {wordmarkFor(platform, name)}
        </span>
      );
    }
    return (
      <svg
        role="img"
        aria-label={name}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={ink}
        className={`inline-block shrink-0 ${className}`}
      >
        <title>{name}</title>
        <path d={path} />
      </svg>
    );
  }

  // Brand hexes run from Snapchat yellow to X black, so the mark's colour is
  // picked per-platform rather than assumed to be white.
  const ink = readableOn(brand);
  const label = wordmarkFor(platform, name);
  // Below ~18px the mark needs more of the square, or it turns to mush.
  const ratio = size < 18 ? 0.72 : 0.6;
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        // A squircle, like the app icon each of these marks comes from.
        borderRadius: Math.max(3, size * 0.28),
        // A light sheen off the top-left keeps flat fills from reading as plain
        // colour chips, and gives near-black brands some shape of their own.
        background: `linear-gradient(155deg, color-mix(in oklab, #ffffff 18%, ${brand}), ${brand})`,
        color: ink,
        // Hairline of the mark's own colour: the only thing separating a black
        // tile from a dark page, or Snapchat yellow from a white one.
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${ink} 16%, transparent)`,
      }}
    >
      {path ? (
        <svg viewBox="0 0 24 24" width={size * ratio} height={size * ratio} fill="currentColor" aria-hidden>
          <path d={path} />
        </svg>
      ) : (
        <span
          className="font-bold"
          style={{ fontSize: size * (label.length > 2 ? 0.34 : 0.42), letterSpacing: "-0.04em" }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
