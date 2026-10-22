/**
 * Fly.io service. Env: RPC_URL, POOL_ADDRESS, RELAYER_PRIVATE_KEY, INTERNAL_TOKEN, PORT.
 * Reachable only from apps/api over Fly's private network; requests arrive already
 * OHTTP-decapsulated, so this service never sees a user's IP.
 */
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { RelayError, createRelayer } from "./relayer";

const env = z
  .object({
    RPC_URL: z.url(),
    POOL_ADDRESS: z.string().refine(isAddress),
    RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    INTERNAL_TOKEN: z.string().min(32),
    PORT: z.coerce.number().default(8080),
  })
  .parse(process.env);

const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`);
const transport = http(env.RPC_URL);
const relayer = createRelayer({
  pool: env.POOL_ADDRESS,
  account,
  publicClient: createPublicClient({ transport }),
  walletClient: createWalletClient({ transport, account }),
});

const Body = z.object({ fn: z.string(), args: z.array(z.unknown()) });

export const app = new Hono();
app.get("/health", (c) => c.json({ data: { ok: true, relayer: relayer.address, feeFloor: relayer.feeFloor.toString() } }));
app.use("/relay", bearerAuth({ token: env.INTERNAL_TOKEN }));
app.post("/relay", async (c) => {
  const body = Body.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: { code: "bad_request", message: "expected { fn, args }" } }, 400);
  try {
    return c.json({ data: await relayer.relay(body.data.fn, body.data.args) });
  } catch (e) {
    const msg = e instanceof RelayError ? e.message : "relay failed";
    return c.json({ error: { code: "rejected", message: msg } }, 422);
  }
});

export default { port: env.PORT, fetch: app.fetch };
console.log(`[relayer] ${relayer.address} on :${env.PORT}`);
