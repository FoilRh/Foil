/**
 * Local Foil: anvil + contracts (real verifiers, dev keys) + relayer + round operator +
 * API gateway + OHTTP relay, then writes apps/web/.env.local so `bun run dev` in
 * apps/web runs the dashboard live against it.
 *   bun scripts/dev-stack.ts
 *   bun scripts/dev-stack.ts fund <stashAddress> <usdg>   (separate terminal)
 * Dev only: anvil's public test keys, a mock USDG, ports 8545/8787/8788.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeKeyConfig, generateGatewayKey, hex } from "@foil/ohttp";
import { stashPoolAbi, toJson, usdgAbi } from "@foil/protocol";
import { createApp } from "../apps/api/src/app";
import { memoryStores } from "../apps/api/src/stores";
import { createRelay } from "../services/ohttp-relay/src/relay";
import { createRelayer } from "../services/relayer/src/relayer";
import { createOperator } from "../services/round-operator/src/operator";
import { memoryRevealStore } from "../services/round-operator/src/store";
import { ANVIL_KEYS, startDevchain } from "./devchain";
import { createIndexer } from "../services/indexer/src/indexer";

const RPC = "http://127.0.0.1:8545";

if (process.argv[2] === "fund") {
  // Deposit from anvil account #4 into a Foil stash address (as a user's outside wallet would).
  // Testnet: RPC_URL, CHAIN_ID=46630 and FUND_PRIVATE_KEY (e.g. the deployer; mock USDG mints freely).
  const rpc = process.env.RPC_URL ?? RPC;
  const [, , , stash, usdgAmount] = process.argv;
  const { loadCrypto, parseStashAddress, npkOf, randomField, encryptNote, splitBlob } = await import("@foil/client");
  const dep = JSON.parse(await Bun.file(join(import.meta.dir, "..", "contracts", "deployments", `${process.env.CHAIN_ID ?? 31337}.json`)).text());
  const c = await loadCrypto();
  const to = parseStashAddress(stash!);
  const amount = BigInt(Math.round(Number(usdgAmount ?? "100") * 1e6));
  const rho = randomField();
  const fee = (amount * 15n + 9_999n) / 10_000n;
  const { ciphertext, epk } = splitBlob(encryptNote(to.ekPub, amount - fee, rho));
  const account = privateKeyToAccount((process.env.FUND_PRIVATE_KEY ?? ANVIL_KEYS[4]!) as `0x${string}`);
  const pub = createPublicClient({ transport: http(rpc) });
  const w = createWalletClient({ transport: http(rpc), account });
  const send = async (address: Address, abi: unknown, functionName: string, args: unknown[]) =>
    pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, chain: null } as never) });
  await send(dep.usdg, usdgAbi, "mint", [account.address, amount]);
  await send(dep.usdg, usdgAbi, "approve", [dep.pool, amount]);
  await send(dep.pool, stashPoolAbi, "deposit", [amount, npkOf(c, to.mpk, rho), ciphertext, epk]);
  console.log(`deposited ${usdgAmount ?? 100} USDG to the stash; it is admitted after standby (advance anvil time or wait 60 min)`);
  process.exit(0);
}

const relayerAcct = privateKeyToAccount(ANVIL_KEYS[3]!);
const operatorAcct = privateKeyToAccount(ANVIL_KEYS[1]!);
const chain = await startDevchain({ port: 8545, mockVerifiers: false, operator: operatorAcct.address });
const { pool, usdg, gate, chainId } = chain.deployment;
const transport = http(chain.rpc);
const publicClient = createPublicClient({ transport });
const relayer = createRelayer({ pool, account: relayerAcct, publicClient: publicClient as never, walletClient: createWalletClient({ transport, account: relayerAcct }) });
const operator = createOperator({
  pool, chainId, account: operatorAcct, publicClient: publicClient as never,
  walletClient: createWalletClient({ transport, account: operatorAcct }), store: memoryRevealStore(), log: (m) => console.log(`[operator] ${m}`),
});
const key = await generateGatewayKey(1);
const stores = memoryStores();
const api = createApp(key, {
  chain: publicClient as never, pool, usdg, gate, chainId, startBlock: 0n,
  relayer: { address: relayerAcct.address, feeFloor: "250000" },
    stores,
    attest: async () => [], // no ppoi-nodes locally: entries admit after standby
  internal: async (service, _p, body) => {
    if (service === "relayer") {
      const b = body as { fn: string; args: unknown[] };
      return relayer.relay(b.fn, b.args);
    }
    const b = body as { roundId: string; tin: Address; salt: `0x${string}` };
    return toJson(await operator.acceptReveal(BigInt(b.roundId), { tin: b.tin, salt: b.salt }));
  },
});
Bun.serve({ port: 8787, fetch: api.fetch });
Bun.serve({ port: 8788, fetch: createRelay({ gatewayUrl: "http://127.0.0.1:8787/gateway", allowedOrigins: ["http://localhost:3000"] }) });
setInterval(() => operator.tick().catch((e) => console.error(`[operator] ${(e as Error).message}`)), 10_000);
const indexer = createIndexer(publicClient as never, { pool, usdg, startBlock: 0n, confirmations: 0n });
setInterval(() => indexer.catchUp().then(() => stores.setSnapshot(indexer.set.snapshot())).catch((e) => console.error(`[indexer] ${(e as Error).message}`)), 10_000);

writeFileSync(
  join(import.meta.dir, "..", "apps", "web", ".env.local"),
  `NEXT_PUBLIC_OHTTP_RELAY_URL=http://127.0.0.1:8788\nNEXT_PUBLIC_OHTTP_KEY_CONFIG=${hex(encodeKeyConfig(key))}\n`,
);
console.log(`Foil dev stack: pool ${pool}\n  API gateway http://127.0.0.1:8787  OHTTP relay http://127.0.0.1:8788\n  wrote apps/web/.env.local; run \`bun run dev\` in apps/web`);
process.on("SIGINT", () => {
  chain.stop();
  process.exit(0);
});
