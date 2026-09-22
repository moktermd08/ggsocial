import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, brands, brandBookDefaults } from "@/lib/db";
import { inheritState, planSync } from "@/lib/masters";
import {
  BOOK_FIELDS, bookColumns, bookValues, isEmptyBookValue, type BookField,
} from "@/lib/brand-book";

export type BookDefaultsRow = typeof brandBookDefaults.$inferSelect;
type BrandRow = typeof brands.$inferSelect;

export async function getBookDefaults(ownerId: string) {
  return await db.query.brandBookDefaults.findFirst({ where: eq(brandBookDefaults.ownerId, ownerId) }) ?? null;
}

export async function getBookDefaultsById(id: string) {
  return await db.query.brandBookDefaults.findFirst({ where: eq(brandBookDefaults.id, id) }) ?? null;
}

export function bookState(brand: BrandRow, defaults: BookDefaultsRow) {
  return inheritState(BOOK_FIELDS, bookValues(brand), brand.bookSnapshot, bookValues(defaults));
}

/** Where each of these brands stands against its master book, keyed by brand id. */
export async function bookStates(brandRows: BrandRow[]) {
  const ids = [...new Set(brandRows.map((b) => b.bookDefaultsId).filter((x): x is string => Boolean(x)))];
  const books = ids.length ? await db.select().from(brandBookDefaults).where(inArray(brandBookDefaults.id, ids)) : [];
  const byId = new Map(books.map((b) => [b.id, b]));
  const out = new Map<string, ReturnType<typeof bookState>>();
  for (const b of brandRows) {
    const book = b.bookDefaultsId ? byId.get(b.bookDefaultsId) : undefined;
    if (book) out.set(b.id, bookState(b, book));
  }
  return out;
}

/**
 * Brings one brand's book up to date with the master. Never locked: a brand
 * book is guidance, not something that has been approved and sent.
 */
export async function syncBrandBook(brandId: string, opts: { accept?: BookField[]; keep?: BookField[] } = {}) {
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  if (!brand?.bookDefaultsId) return;
  const book = await getBookDefaultsById(brand.bookDefaultsId);
  if (!book) return;
  const { next, snapshot } = planSync(BOOK_FIELDS, bookValues(brand), brand.bookSnapshot, bookValues(book), opts);
  await db.update(brands).set({ ...bookColumns(next), bookSnapshot: snapshot }).where(eq(brands.id, brandId));
}

export async function syncAllBrandBooks(defaultsId: string) {
  const linked = await db.select({ id: brands.id }).from(brands).where(eq(brands.bookDefaultsId, defaultsId));
  for (const b of linked) await syncBrandBook(b.id);
  return linked.length;
}

/**
 * Links a brand to a master book. Fields the brand has left empty take the
 * master's value; anything it has already written stays, marked customised.
 */
export async function linkBrandToBook(brandId: string, defaultsId: string) {
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  const book = await getBookDefaultsById(defaultsId);
  if (!brand || !book) return;
  const current = bookValues(brand);
  const empty = BOOK_FIELDS.filter((f) => isEmptyBookValue(f, current[f]));
  // The snapshot starts at the master as it is now, so a later master change
  // shows up even on fields this brand had already made its own.
  await db.update(brands).set({ bookDefaultsId: defaultsId, bookSnapshot: bookValues(book) }).where(eq(brands.id, brandId));
  await syncBrandBook(brandId, { accept: empty });
}
