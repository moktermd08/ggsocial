/**
 * Where the brand's visuals start. Every graphic is designed in Canva from
 * the brand's own kit; these are the approved places to fetch the raw
 * material that goes into a design. Client-safe: the playbook, the brand
 * page, the agent API and the writers' brand book all read this one list.
 */
export type AssetSource = { name: string; url: string; for: string };

export const ASSET_SOURCES: AssetSource[] = [
  { name: "Storyset", url: "https://storyset.com/", for: "editable and animated illustrations, recoloured to the brand palette" },
  { name: "unDraw", url: "https://undraw.co/illustrations", for: "flat illustrations, with the accent colour set to the brand's" },
  { name: "Humaaans", url: "https://www.humaaans.com/", for: "mix-and-match illustrations of people" },
  { name: "SVG Logos", url: "https://svglogos.dev/", for: "logos of tools and companies, only to name a tool or partner factually" },
  { name: "Simple Icons", url: "https://simpleicons.org/", for: "one-colour icons of platforms and tools" },
  { name: "Lucide", url: "https://lucide.dev/", for: "interface and line icons" },
  { name: "Unsplash", url: "https://unsplash.com/", for: "photos" },
  { name: "Pexels", url: "https://www.pexels.com/", for: "photos, and video clips for reels and shorts" },
  { name: "LottieFiles", url: "https://lottiefiles.com/", for: "animations for reels, stories and shorts" },
  { name: "Haikei", url: "https://haikei.app/", for: "generated backgrounds (waves, blobs, gradients) in the brand's colours" },
  { name: "Mockup World", url: "https://www.mockupworld.co/", for: "device and print mockups to show the product in use" },
];

/** The list as text lines, for instructions and prompts. */
export function assetSourceLines() {
  return ASSET_SOURCES.map((s) => `• ${s.name} (${s.url}): ${s.for}`);
}
