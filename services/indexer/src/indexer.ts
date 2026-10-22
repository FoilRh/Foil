import type { Address, PublicClient } from "viem";
import { desc, sql } from "drizzle-orm";
import { schema, type Db } from "@foil/db";
import { TinSet, type Snapshot } from "./state";

export interface IndexerConfig { pool: Address; usdg: Address; cardNft?: Address; startBlock: bigint; confirmations?: bigint; range?: bigint }

/**
 * Pulls pool, USDG and card-NFT logs up to (head − confirmations) and applies them.
 * On start it resumes from the last persisted snapshot (`resume`), so a cold start
 * replays only the blocks since then.
 */
export function createIndexer(client: PublicClient, cfg: IndexerConfig) {
  const set = new TinSet({ pool: cfg.pool, usdg: cfg.usdg, cardNft: cfg.cardNft });
  let next = cfg.startBlock;
  const addresses = [cfg.pool, cfg.usdg, ...(cfg.cardNft ? [cfg.cardNft] : [])];

  return {
    set,
    get nextBlock() {
      return next;
    },
    /** Continue after `block` (the last block a persisted snapshot covers). */
    resume(block: bigint, snap: Snapshot, sendBacks: Map<string, { sentBack: bigint; sendBacks: number }>) {
      if (block < next || snap.pool?.toLowerCase() !== cfg.pool.toLowerCase()) return; // another deployment's
      set.load(snap, sendBacks);
      next = block + 1n;
    },
    /** Index everything confirmed so far. Returns the last block indexed. */
    async catchUp(): Promise<bigint> {
      const head = (await client.getBlockNumber({ cacheTime: 0 })) - (cfg.confirmations ?? 2n); // never a cached head
      while (next <= head) {
        const to = next + (cfg.range ?? 2_000n) - 1n > head ? head : next + (cfg.range ?? 2_000n) - 1n;
        set.apply(await client.getLogs({ address: addresses, fromBlock: next, toBlock: to }));
        next = to + 1n;
      }
      return next - 1n;
    },
  };
}

/** Load the newest snapshot and its send-back counters, to resume from. */
export async function loadCheckpoint(db: Db) {
  const [last] = await db.select().from(schema.snapshots).orderBy(desc(schema.snapshots.block)).limit(1);
  if (!last) return null;
  const rows = await db.select().from(schema.tinsPub);
  return {
    block: last.block,
    snap: JSON.parse(last.body) as Snapshot,
    sendBacks: new Map(rows.map((r) => [r.tin.toLowerCase(), { sentBack: BigInt(r.sentBack), sendBacks: r.sendBacks }])),
  };
}

/**
 * Write public rows and one snapshot document, in one transaction so a resume never sees
 * send-back counters from a different block than the snapshot. Idempotent.
 */
export async function persist(db: Db, set: TinSet, lastBlock: bigint) {
  const snap = set.snapshot();
  const ev = set.poolEvents.splice(0);
  try {
    await db.transaction(async (tx) => {
      if (ev.length) {
        await tx.insert(schema.poolEvents)
          .values(ev.map((e) => ({ tx: e.tx, logIndex: e.logIndex, block: e.block, kind: e.kind, size: e.size?.toString() ?? null, ts: new Date() })))
          .onConflictDoNothing();
      }
      for (const t of set.tins.values()) {
        await tx.insert(schema.tinsPub)
          .values({ tin: t.tin, roundId: BigInt(t.roundId), funded: t.funded.toString(), sentBack: t.sentBack.toString(), sendBacks: t.sendBacks })
          .onConflictDoUpdate({ target: schema.tinsPub.tin, set: { funded: t.funded.toString(), sentBack: t.sentBack.toString(), sendBacks: t.sendBacks } });
        for (const id of t.cards) {
          await tx.insert(schema.cards).values({ tokenId: id, tin: t.tin, updatedAt: new Date() })
            .onConflictDoUpdate({ target: schema.cards.tokenId, set: { tin: t.tin, updatedAt: new Date() } });
        }
      }
      await tx.insert(schema.snapshots).values({ block: lastBlock, body: JSON.stringify(snap) }).onConflictDoNothing();
      // Keep a day of snapshots (always the newest: it is the resume point).
      await tx.execute(sql`delete from snapshots where created_at < now() - interval '1 day' and block < ${lastBlock}`);
    });
  } catch (e) {
    set.poolEvents.unshift(...ev); // retried on the next persist
    throw e;
  }
  return snap;
}
