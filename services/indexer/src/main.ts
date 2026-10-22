/**
 * Fly.io service. Env: RPC_URL, POOL_ADDRESS, USDG_ADDRESS, CARD_NFT_ADDRESS (optional),
 * START_BLOCK, DATABASE_URL, POLL_MS (default 15s), SNAPSHOT_MS (default 5 min).
 */
import { createPublicClient, http, isAddress, type Address } from "viem";
import { z } from "zod";
import { createDb, schema } from "@foil/db";
import { createIndexer, loadCheckpoint, persist } from "./indexer";

const addr = z.string().refine(isAddress).transform((a) => a as Address);
const env = z.object({
  RPC_URL: z.url(),
  POOL_ADDRESS: addr,
  USDG_ADDRESS: addr,
  CARD_NFT_ADDRESS: addr.optional(),
  START_BLOCK: z.coerce.bigint(),
  DATABASE_URL: z.string().min(1),
  POLL_MS: z.coerce.number().default(15_000),
  SNAPSHOT_MS: z.coerce.number().default(300_000),
}).parse(process.env);

const { db } = createDb(env.DATABASE_URL);
const indexer = createIndexer(createPublicClient({ transport: http(env.RPC_URL) }), {
  pool: env.POOL_ADDRESS, usdg: env.USDG_ADDRESS, cardNft: env.CARD_NFT_ADDRESS, startBlock: env.START_BLOCK,
});

let lastSnapshot = 0;
let busy = false;
let resumed = false;
/**
 * One poll: resume from the DB checkpoint on first run, catch up to the chain head, snapshot
 * every SNAPSHOT_MS, and record a status row. Re-entrant calls are skipped; errors are logged, not thrown.
 */
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!resumed) {
      const c = await loadCheckpoint(db);
      if (c) indexer.resume(c.block, c.snap, c.sendBacks);
      resumed = true;
    }
    const last = await indexer.catchUp();
    if (Date.now() - lastSnapshot >= env.SNAPSHOT_MS) {
      const snap = await persist(db, indexer.set, last);
      lastSnapshot = Date.now();
      console.log(`[indexer] block ${last}: ${snap.tins.length} tins`);
    }
    await db.insert(schema.status).values({ component: "indexer", ok: true, detail: `block ${last}` });
  } catch (e) {
    console.error(`[indexer] ${(e as Error).message}`);
    await db.insert(schema.status).values({ component: "indexer", ok: false, detail: (e as Error).message.slice(0, 200) }).catch(() => {});
  } finally {
    busy = false;
  }
}
if (!process.env.VERCEL) {
  setInterval(tick, env.POLL_MS);
  void tick();
}
