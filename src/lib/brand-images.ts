/**
 * A brand's image slots: three versions of the logo, the image a shared link
 * shows, and the fallback visual for posts. Client-safe, so the brand page and
 * the upload action read the same list.
 */
export const BRAND_IMAGE_SLOTS = {
  logo: {
    column: "logoUrl",
    tag: "logo",
    label: "Primary logo",
    hint: "The full lockup. Shown wherever the brand has one mark.",
    shape: "square",
  },
  logoIcon: {
    column: "logoIconUrl",
    tag: "logo",
    label: "Icon / mark",
    hint: "The symbol on its own, for avatars and small sizes.",
    shape: "square",
  },
  logoReversed: {
    column: "logoReversedUrl",
    tag: "logo",
    label: "Reversed logo",
    hint: "For dark or photo backgrounds — usually white.",
    shape: "square-dark",
  },
  social: {
    column: "socialImageUrl",
    tag: "social image",
    label: "Social image",
    hint: "What a shared link shows. 1200×630.",
    shape: "wide",
  },
  default: {
    column: "defaultImageUrl",
    tag: "default image",
    label: "Default image",
    hint: "The fallback visual for a post that needs an image and has none.",
    shape: "wide",
  },
} as const;

export type BrandImageSlot = keyof typeof BRAND_IMAGE_SLOTS;
export type BrandImageColumn = (typeof BRAND_IMAGE_SLOTS)[BrandImageSlot]["column"];

export const LOGO_SLOTS = ["logo", "logoIcon", "logoReversed"] as const satisfies readonly BrandImageSlot[];

export function isBrandImageSlot(v: string): v is BrandImageSlot {
  return Object.hasOwn(BRAND_IMAGE_SLOTS, v);
}
