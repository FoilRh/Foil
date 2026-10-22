import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";

/**
 * Server-only. DATABASE_URL is the Supabase pooler URL (transaction mode, port 6543),
 * so prepared statements are off.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 5 });
  return { db: drizzle(sql, { schema }), sql };
}
export type Db = ReturnType<typeof createDb>["db"];
