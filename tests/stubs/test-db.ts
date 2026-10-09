/** An in-memory Postgres (PGlite) built from the app schema, standing in for `@/lib/db` in tests. */
export async function makeTestDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("../../src/lib/db/schema");
  const db = drizzle(new PGlite(), { schema });
  const { apply } = await pushSchema(schema, db as never);
  await apply();
  return { db, schema, ...schema };
}
