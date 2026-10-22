/**
 * Fly.io service. Env:
 *   RPC_URL, CHAIN_ID, POOL_ADDRESS, OPERATOR_PRIVATE_KEY, DATABASE_URL,
 *   INTERNAL_TOKEN (shared with apps/api, which forwards OHTTP-decapsulated reveals),
 *   PORT (default 8080), TICK_MS (default 15000)
 * The operator learns tin addresses, never users: reveals arrive via OHTTP → API.
 */
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createPublicClient, createWalletClient, http, isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { createDb, schema } from "@foil/db";
import { createOperator, RevealRejected } from "./operator";
import { memoryRevealStore, pgRevealStore } from "./store";

const env = z
  .object({
    RPC_URL: z.url(),
    CHAIN_ID: z.coerce.number().int(),
    POOL_ADDRESS: z.string().refine(isAddress),
    OPERATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    DATABASE_URL: z.string().optional(),
    INTERNAL_TOKEN: z.string().min(32),
    PORT: z.coerce.number().default(8080),
    TICK_MS: z.coerce.number().default(15_000),
  })
  .parse(process.env);

const account = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY as `0x${string}`);
const transport = http(env.RPC_URL);
const db = env.DATABASE_URL ? createDb(env.DATABASE_URL).db : undefined;
const operator = createOperator({
  pool: env.POOL_ADDRESS,
  chainId: env.CHAIN_ID,
  account,
  publicClient: createPublicClient({ transport }),
  walletClient: createWalletClient({ transport, account }),
  store: db ? pgRevealStore(db) : memoryRevealStore(),
  log: (m) => console.log(`[round-operator] ${m}`),
});

const Reveal = z.object({
  roundId: z.string().regex(/^\d+$/),
  tin: z.string().refine(isAddress),
  salt: z.string().refine((s) => isHex(s) && s.length === 66),
});

export const app = new Hono();
app.get("/health", (c) => c.json({ data: { ok: true, operator: account.address } }));
app.use("/reveal", bearerAuth({ token: env.INTERNAL_TOKEN }));
app.post("/reveal", async (c) => {
  const parsed = Reveal.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: "invalid reveal" } }, 400);
  try {
    const r = await operator.acceptReveal(BigInt(parsed.data.roundId), { tin: parsed.data.tin, salt: parsed.data.salt as `0x${string}` });
    return c.json({ data: { ...r, roundId: r.roundId.toString(), tinCommit: r.tinCommit.toString(), receivedAt: r.receivedAt.toString() } });
  } catch (e) {
    // Only deliberate rejections carry their message; RPC errors could leak internals.
    if (e instanceof RevealRejected) return c.json({ error: { code: "rejected", message: e.message } }, 422);
    console.error("[round-operator] reveal failed");
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  }
});

async function heartbeat(ok: boolean, detail?: string) {
  if (!db) return;
  await db.insert(schema.status).values({ component: "round-operator", ok, detail }).catch(() => {});
}

let running = false;
/** One operator pass plus a status heartbeat; skipped if a pass is already running. Also called by /tick on Vercel. */
export async function tick() {
  if (running) return;
  running = true;
  try {
    await operator.tick();
    await heartbeat(true);
  } catch (e) {
    console.error(`[round-operator] tick failed: ${(e as Error).message}`);
    await heartbeat(false, (e as Error).message.slice(0, 200));
  } finally {
    running = false;
  }
}
// On Vercel there is no long-lived process: a scheduler calls /tick instead (services/vercel).
if (!process.env.VERCEL) setInterval(tick, env.TICK_MS);

export default { port: env.PORT, fetch: app.fetch };
console.log(`[round-operator] ${account.address} on :${env.PORT}`);
