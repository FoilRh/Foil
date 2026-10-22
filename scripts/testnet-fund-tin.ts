/**
 * Testnet prep for testnet-rip.ts: gives the test wallet (TEST_WALLET_MNEMONIC) a $25 tin.
 * Deposits from the deployer if the Stash is short (mock USDG mints freely), admits with the
 * ppoi signatures through the live relay, then requests a tin of `size` (default 25) at tin
 * index `index` (default 100, clear of indices used on earlier pools). The round closes on its
 * own (30 min with fewer than 8 requests) and the operator funds the tin.
 *   bun scripts/testnet-fund-tin.ts [size] [index]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stashPoolAbi, usdgAbi, type TinSize } from "@foil/protocol";
import {
  Wallet, createApi, createChainClient, emptyState, encryptNote, keysFromMnemonic, loadCrypto, localProver, npkOf,
  randomField, splitBlob, type Artifacts, type TinSnapshot,
} from "@foil/client";

const root = join(import.meta.dir, "..");
const env = Object.fromEntries(readFileSync(join(root, "deploy", "testnet.env"), "utf8").split(/\r?\n/).flatMap((l) => {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
  return m ? [[m[1]!, m[2]!]] : [];
})) as Record<string, string>;
const urls = JSON.parse(readFileSync(join(root, "deploy", "testnet-urls.json"), "utf8")) as Record<string, string>;
const art = (f: string) => join(root, "circuits", "build", "artifacts", f);
const artifacts: Artifacts = { load: async (n) => ({ wasm: art(`${n}.wasm`), zkey: art(`${n}.zkey`) }) };
const size = Number(process.argv[2] ?? 25) as TinSize;
const index = Number(process.argv[3] ?? 100);

const api = createApi({ relayUrl: urls.relay!, keyConfig: env.OHTTP_KEY_CONFIG! });
const chain = createChainClient(api);
const cfg = await api.config.query();
if (cfg.chainId !== 46630) throw new Error(`expected testnet, API serves ${cfg.chainId}`);
const c = await loadCrypto();
const keys = keysFromMnemonic(c, env.TEST_WALLET_MNEMONIC!.replaceAll("-", " "));
const wallet = new Wallet(c, keys, api, chain as never, {
  chainId: cfg.chainId, pool: cfg.pool as Address, usdg: cfg.usdg as Address, poolId: BigInt(cfg.poolId),
  relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock: BigInt(cfg.startBlock),
  admitJitterMs: 0,
}, localProver(artifacts), emptyState(BigInt(cfg.startBlock)));
const log = (s: string) => console.log(`• ${s}`);

await wallet.sync();
const need = BigInt(size) * 1_000_000n + 2_000_000n; // size + tin fees + gas fee + relayer fee
if (wallet.balance < need && !wallet.state.entries.some((e) => e.state === "Pending")) {
  const amount = need * 2n;
  const rho = randomField();
  const { ciphertext, epk } = splitBlob(encryptNote(keys.ekPub, amount - (amount * 15n + 9_999n) / 10_000n, rho));
  const rpc = "https://rpc.testnet.chain.robinhood.com";
  const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ transport: http(rpc) });
  const w = createWalletClient({ transport: http(rpc), account });
  const send = async (address: Address, abi: unknown, functionName: string, args: unknown[]) =>
    pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, chain: null } as never) });
  await send(cfg.usdg as Address, usdgAbi, "mint", [account.address, amount]);
  await send(cfg.usdg as Address, usdgAbi, "approve", [cfg.pool, amount]);
  await send(cfg.pool as Address, stashPoolAbi, "deposit", [amount, npkOf(c, keys.owner.mpk, rho), ciphertext, epk]);
  log(`deposited ${amount / 1_000_000n} USDG from the deployer`);
  await wallet.sync();
}
for (let i = 0; i < 30 && wallet.balance < need; i++) {
  if (await wallet.admitReady()) log("admitted an entry with both ppoi signatures");
  await wallet.sync();
  if (wallet.balance < need) await new Promise((r) => setTimeout(r, 10_000));
}
if (wallet.balance < need) throw new Error(`Stash holds ${wallet.balance}, need ${need}`);
log(`Stash: ${wallet.balance / 1_000_000n} USDG`);

wallet.state = { ...wallet.state, nextTin: Math.max(wallet.state.nextTin, index) };
wallet.discover((await api.snapshot.query()) as TinSnapshot);
const tin = await wallet.requestTin(size);
log(`requested a $${size} tin #${tin.index} ${tin.address} in round ${tin.roundId}; receipt verified`);
console.log("the round closes within 30 minutes and the operator funds the tin; then run scripts/testnet-rip.ts");
process.exit(0);
