import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@foil/db";
import type { Reveal } from "./plan";

/** Where accepted reveals wait until their round executes. Postgres in production. */
export interface RevealStore {
  put(roundId: bigint, r: Reveal): Promise<void>;
  list(roundId: bigint): Promise<Reveal[]>;
  clear(roundId: bigint): Promise<void>;
}

/** Postgres RevealStore on `pending_reveals`; duplicate puts are ignored. */
export function pgRevealStore(db: Db): RevealStore {
  const t = schema.pendingReveals;
  return {
    async put(roundId, r) {
      await db.insert(t).values({ roundId, tin: r.tin, salt: r.salt }).onConflictDoNothing();
    },
    async list(roundId) {
      const rows = await db.select({ tin: t.tin, salt: t.salt }).from(t).where(eq(t.roundId, roundId));
      return rows as Reveal[];
    },
    async clear(roundId) {
      await db.delete(t).where(and(eq(t.roundId, roundId)));
    },
  };
}

/** For tests and local runs without a database. */
export function memoryRevealStore(): RevealStore {
  const m = new Map<bigint, Reveal[]>();
  return {
    async put(roundId, r) {
      const list = m.get(roundId) ?? [];
      if (!list.some((x) => x.tin.toLowerCase() === r.tin.toLowerCase() && x.salt.toLowerCase() === r.salt.toLowerCase())) list.push(r);
      m.set(roundId, list);
    },
    async list(roundId) {
      return m.get(roundId) ?? [];
    },
    async clear(roundId) {
      m.delete(roundId);
    },
  };
}
