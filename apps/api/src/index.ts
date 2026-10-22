/**
 * Builds the API from env. Env (Vercel, server-only):
 *   RPC_URL, CHAIN_ID, POOL_ADDRESS, USDG_ADDRESS, GATE_ADDRESS,
 *   OHTTP_KEY_ID, OHTTP_PRIVATE_KEY, OHTTP_PUBLIC_KEY (hex),
 *   RELAYER_URL, RELAYER_ADDRESS, RELAYER_TOKEN, OPERATOR_URL, OPERATOR_TOKEN, START_BLOCK,
 *   DATABASE_URL, PPOI_URLS, PPOI_TOKENS
 * Every internal service has its OWN bearer token (its INTERNAL_TOKEN). ppoi-nodes are run
 * by independent operators, so a node's token must never open the relayer or operator.
 */
import { createPublicClient, http, isAddress, type Address } from "viem";
import { z } from "zod";
import { FEES } from "@foil/protocol";
import { unhex } from "@foil/ohttp";
import { createDb } from "@foil/db";
import { createApp } from "./app";
import type { Ctx } from "./router";
import { pgStores } from "./stores";

export type { AppRouter } from "./router";
export { createApp } from "./app";
export { memoryStores, pgStores, type Stores } from "./stores";

const addr = z.string().refine(isAddress).transform((a) => a as Address);
const Env = z.object({
  RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().int().refine((n) => n === 4663 || n === 46630, "RHC mainnet (4663) or testnet (46630)"),
  POOL_ADDRESS: addr,
  USDG_ADDRESS: addr,
  GATE_ADDRESS: addr,
  OHTTP_KEY_ID: z.coerce.number().int().min(0).max(255),
  OHTTP_PRIVATE_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  OHTTP_PUBLIC_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  RELAYER_URL: z.url(),
  RELAYER_ADDRESS: addr,
  OPERATOR_URL: z.url(),
  RELAYER_TOKEN: z.string().min(32),
  OPERATOR_TOKEN: z.string().min(32),
  START_BLOCK: z.coerce.bigint().default(0n),
  CARD_NFT_ADDRESS: addr.optional(),
  CC_VAULT_ADDRESS: addr.optional(),
  SHIPPING_PAYEES: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter((x) => isAddress(x)) as Address[]),
  DATABASE_URL: z.string().min(1),
  /** Comma-separated internal ppoi-node URLs, and one token per node in the same order. */
  PPOI_URLS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  PPOI_TOKENS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
}).refine((e) => e.PPOI_URLS.length === e.PPOI_TOKENS.length && e.PPOI_TOKENS.every((t) => t.length >= 32), {
  message: "PPOI_TOKENS needs one token (32+ chars) per PPOI_URLS entry",
}).refine((e) => new Set([e.RELAYER_TOKEN, e.OPERATOR_TOKEN, ...e.PPOI_TOKENS]).size === 2 + e.PPOI_TOKENS.length, {
  message: "every internal service needs a distinct token",
});

type Service = { url: string; token: string };

/** Bearer-authed POST to the relayer or round operator; only the relayer's 422 reasons are exposed to clients. */
export function internalCaller(services: { relayer: Service; operator: Service }): Ctx["internal"] {
  return async (service, path, body) => {
    const { url, token } = services[service];
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { data?: unknown; error?: { message: string } } | null;
    // The relayer answers only with its own RelayError reasons, safe to show (expose). The operator may
    // echo internals, so its reasons stay behind the API's fixed "internal error".
    if (json?.error && res.status === 422 && service === "relayer") throw Object.assign(new Error(json.error.message), { expose: true });
    if (!res.ok || !json || json.error) throw new Error(json?.error?.message ?? `${service} unavailable`);
    return json.data;
  };
}

/** Ask every ppoi-node; keep the signatures of those that judge the entry clean. */
export function ppoiAttester(nodes: Service[]): Ctx["attest"] {
  return async (seq) => {
    const results = await Promise.allSettled(nodes.map(async ({ url, token }) => {
      const res = await fetch(`${url}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ seq: seq.toString() }),
      });
      const json = (await res.json()) as { data?: { signature: string } };
      if (!res.ok || !json.data) throw new Error("not attested");
      return json.data.signature;
    }));
    return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  };
}

/** Validates env (throws on bad config) and wires chain, stores and internal services into createApp. */
export function appFromEnv(source: Record<string, string | undefined> = process.env) {
  const env = Env.parse(source);
  const ctx: Ctx = {
    chain: createPublicClient({ transport: http(env.RPC_URL) }),
    pool: env.POOL_ADDRESS,
    usdg: env.USDG_ADDRESS,
    gate: env.GATE_ADDRESS,
    chainId: env.CHAIN_ID,
    startBlock: env.START_BLOCK,
    cardNft: env.CARD_NFT_ADDRESS,
    vault: env.CC_VAULT_ADDRESS,
    shippingPayees: env.SHIPPING_PAYEES,
    internal: internalCaller({
      relayer: { url: env.RELAYER_URL, token: env.RELAYER_TOKEN },
      operator: { url: env.OPERATOR_URL, token: env.OPERATOR_TOKEN },
    }),
    relayer: { address: env.RELAYER_ADDRESS, feeFloor: FEES.relayerFloor.toString() },
    stores: pgStores(createDb(env.DATABASE_URL).db),
    attest: ppoiAttester(env.PPOI_URLS.map((url, i) => ({ url, token: env.PPOI_TOKENS[i]! }))),
  };
  return createApp({ keyId: env.OHTTP_KEY_ID, privateKey: unhex(env.OHTTP_PRIVATE_KEY), publicKey: unhex(env.OHTTP_PUBLIC_KEY) }, ctx);
}
