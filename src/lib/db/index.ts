import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

// Next dev reloads modules on every edit; reuse one pool so we don't exhaust connections.
const globalForDb = globalThis as unknown as { __ggsocialSql?: ReturnType<typeof postgres> };
const sql = globalForDb.__ggsocialSql ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__ggsocialSql = sql;

export const db = drizzle(sql, { schema });
export { schema, sql };
export * from "./schema";
