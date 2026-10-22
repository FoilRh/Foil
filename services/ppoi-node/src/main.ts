/**
 * Fly.io service (run ≥ 2, ideally by independent operators). Env:
 *   RPC_URL, POOL_ADDRESS, GATE_ADDRESS, USDG_ADDRESS, START_BLOCK, PPOI_PRIVATE_KEY,
 *   BLOCKLIST_URL (JSON array of addresses, e.g. an OFAC SDN ETH address export),
 *   INTERNAL_TOKEN, PORT
 * Reached only by apps/api over the private network.
 */
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createPublicClient, createWalletClient, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { buildPoseidon } from "circomlibjs";
import { Rejected, createNode } from "./node";

const addr = z.string().refine(isAddress).transform((a) => a as Address);
const env = z.object({
  RPC_URL: z.url(),
  POOL_ADDRESS: addr,
  GATE_ADDRESS: addr,
  USDG_ADDRESS: addr,
  START_BLOCK: z.coerce.bigint(),
  PPOI_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  BLOCKLIST_URL: z.url(),
  INTERNAL_TOKEN: z.string().min(32),
  PORT: z.coerce.number().default(8080),
}).parse(process.env);

const blocklist = z.array(addr).parse(await (await fetch(env.BLOCKLIST_URL)).json());
const poseidon = await buildPoseidon();
const account = privateKeyToAccount(env.PPOI_PRIVATE_KEY as `0x${string}`);
const transport = http(env.RPC_URL);
const node = createNode({
  pool: env.POOL_ADDRESS, gate: env.GATE_ADDRESS, usdg: env.USDG_ADDRESS, startBlock: env.START_BLOCK, account,
  publicClient: createPublicClient({ transport }), walletClient: createWalletClient({ transport, account }),
  blocklist, poseidon: (x) => poseidon.F.toObject(poseidon([x])),
});

export const app = new Hono();
app.get("/health", (c) => c.json({ data: { ok: true, provider: node.address, listed: blocklist.length } }));
app.use("/attest", bearerAuth({ token: env.INTERNAL_TOKEN }));
app.post("/attest", async (c) => {
  const body = z.object({ seq: z.string().regex(/^\d+$/) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: { code: "bad_request", message: "expected { seq }" } }, 400);
  try {
    return c.json({ data: { provider: node.address, signature: await node.attest(BigInt(body.data.seq)) } });
  } catch (e) {
    return c.json({ error: { code: "rejected", message: e instanceof Rejected ? e.message : "screening failed" } }, 422);
  }
});

/** Hourly heartbeat: publish the blocklist root, then flag unclean pending entries. Errors are logged, not thrown. */
export const tick = async () => {
  try {
    await node.publishRoot();
    await node.flagBlocked();
  } catch (e) {
    console.error(`[ppoi-node] ${(e as Error).message}`);
  }
};
if (!process.env.VERCEL) {
  setInterval(tick, 60 * 60_000);
  void tick();
}

export default { port: env.PORT, fetch: app.fetch };
console.log(`[ppoi-node] ${node.address}, ${blocklist.length} listed`);
