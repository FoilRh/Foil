import { expect, test } from "bun:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// Build §11 privacy CI. Rip Rooms posts link a tin to a handle by the user's choice.
const ALLOWED_LINKS = new Set(["posts"]);
const NOTE_COLS = /^(note|npk|commitment|nullifier|refund_commit|tin_commit|mpk)/;
const IDENTITY_COLS = /(^|_)(ip|ip_address|user_agent|email|user_id|account|device|install)($|_)/;
const TIN_COLS = /(^|_)tin($|_)|^addr(ess)?$|^owner$|^holder$/;

const tables = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => getTableConfig(t));

test("schema exports tables", () => expect(tables.length).toBeGreaterThan(5));

for (const t of tables) {
  test(`${t.name}: no linking columns`, () => {
    const cols = t.columns.map((c) => c.name);
    expect(cols.filter((c) => IDENTITY_COLS.test(c))).toEqual([]);
    if (ALLOWED_LINKS.has(t.name)) return;
    const tinCols = cols.filter((c) => TIN_COLS.test(c));
    // Tin addresses must use the `tin` name so this check sees them.
    expect(tinCols.filter((c) => c !== "tin")).toEqual([]);
    expect(tinCols.length).toBeLessThanOrEqual(1);
    if (tinCols.length) expect(cols.filter((c) => NOTE_COLS.test(c))).toEqual([]);
  });
}
