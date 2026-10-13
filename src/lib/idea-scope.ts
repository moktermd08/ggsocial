/**
 * Who an idea is for. Client-safe.
 *
 * An idea with no list of brands (the way every idea used to be) is open to
 * every brand its author runs. Aiming it at brands closes it to the rest, so
 * a bakery's writer never picks up a clinic software idea.
 */
export function ideaIsFor(idea: { brandIds: string[] | null }, brandId: string) {
  return !idea.brandIds || idea.brandIds.includes(brandId);
}

/** The brands an idea reaches, given every brand its author runs. */
export function ideaAudience(idea: { brandIds: string[] | null }, authorBrandIds: string[]) {
  return idea.brandIds ? authorBrandIds.filter((id) => idea.brandIds!.includes(id)) : authorBrandIds;
}
