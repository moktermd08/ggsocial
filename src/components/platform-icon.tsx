import { platformOrNull } from "@/lib/platforms";
import { readableOn } from "@/lib/color";

/** Small circular platform mark — a letter badge in the platform's colour. */
export function PlatformIcon({ platform, size = 20 }: { platform: string; size?: number }) {
  const p = platformOrNull(platform);
  const letter = p ? (p.id === "x" ? "X" : p.name[0].toUpperCase()) : "?";
  const background = p?.color ?? "#71717a";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      // Platform hexes run from Snapchat yellow to X black, so the letter colour
      // is picked per-platform rather than assumed to be white.
      style={{ width: size, height: size, background, color: readableOn(background), fontSize: size * 0.5 }}
      title={p?.name ?? platform}
    >
      {letter}
    </span>
  );
}
