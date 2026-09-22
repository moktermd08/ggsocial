import "server-only";
import { cookies } from "next/headers";
import type { BrandWithRole } from "./auth";

const COOKIE = "ggs_brand";

/**
 * Which brand the UI is focused on. "all" means every brand the user can see —
 * that cross-brand view is the whole point of the app, so it is the default.
 *
 * "master" is the layer above the brands: the master copies that each brand
 * works from. Pages without a master layer of their own treat it as "all".
 */
export async function getScope(brands: BrandWithRole[]) {
  const value = (await cookies()).get(COOKIE)?.value ?? "all";
  const isMaster = value === "master";
  const active = value === "all" || isMaster ? null : brands.find((b) => b.id === value) ?? null;
  return {
    activeBrand: active,
    isMaster,
    brandIds: active ? [active.id] : brands.map((b) => b.id),
    value: active ? active.id : isMaster ? "master" : "all",
  };
}
