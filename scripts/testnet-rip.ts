/**
 * Browser mode on testnet, against the mock Collector Crypt (contracts/script/DeployMockCC.s.sol).
 * Restores the test wallet (TEST_WALLET_MNEMONIC, words joined by "-") and drives one funded tin
 * through the live relay → API guarded broadcast, the same path the extension uses:
 *   malicious transactions refused → approve + pay (the rip) → the card lands in the tin →
 *   sell back against a quote signed by CC_QUOTE_PRIVATE_KEY → the tin's USDG returns to the Stash.
 *   bun scripts/testnet-rip.ts [tinIndex] [keep]   (default: the newest funded tin without cards;
 *                                                 keep: stop after the rip, card stays in the tin)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { concatHex, encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { usdgAbi } from "@foil/protocol";
import { CARD_ABI, CC_ABI, ERC20_ABI } from "@foil/guard";
import { Wallet, createApi, createChainClient, emptyState, keysFromMnemonic, loadCrypto, sendFromTin, type Prover, type TinSnapshot } from "@foil/client";

const root = join(import.meta.dir, "..");
const env = Object.fromEntries(readFileSync(join(root, "deploy", "testnet.env"), "utf8").split(/\r?\n/).flatMap((l) => {
  const m = /^([A-Z0-9_]+)=(.+)$/.exec(l.trim());
  return m ? [[m[1]!, m[2]!]] : [];
})) as Record<string, string>;
const urls = JSON.parse(readFileSync(join(root, "deploy", "testnet-urls.json"), "utf8")) as Record<string, string>;
const ATTACKER = "0xbadbadbadbadbadbadbadbadbadbadbadbadbad0" as Address;
const noProofs: Prover = async () => { throw new Error("this script needs no proofs"); };

const api = createApi({ relayUrl: urls.relay!, keyConfig: env.OHTTP_KEY_CONFIG! });
const chain = createChainClient(api) as never as Parameters<typeof sendFromTin>[1];
const cfg = await api.config.query();
if (cfg.chainId !== 46630) throw new Error(`expected testnet, API serves ${cfg.chainId}`);
if (!cfg.cc) throw new Error("the API has no Collector Crypt config (deploy DeployMockCC, then redeploy services)");
const { vault, cards } = cfg.cc as { vault: Address; cards: Address };
const usdg = cfg.usdg as Address;

const c = await loadCrypto();
const wallet = new Wallet(c, keysFromMnemonic(c, env.TEST_WALLET_MNEMONIC!.replaceAll("-", " ")), api, chain as never, {
  chainId: cfg.chainId, pool: cfg.pool as Address, usdg, poolId: BigInt(cfg.poolId),
  relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock: BigInt(cfg.startBlock),
}, noProofs, emptyState(BigInt(cfg.startBlock)));
const want = process.argv[2] === undefined ? undefined : Number(process.argv[2]);
// An explicit index past discovery's 20-tin gap (testnet-fund-tin.ts uses 100) must be scanned too.
if (want !== undefined) wallet.state = { ...wallet.state, nextTin: Math.max(wallet.state.nextTin, want + 1) };
wallet.discover((await api.snapshot.query()) as TinSnapshot);

const usdgOf = (a: Address) => chain.readContract({ address: usdg, abi: usdgAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const candidates = wallet.state.tins.filter((t) => (want === undefined ? !t.cards?.length : t.index === want));
let tin;
for (const t of candidates) if (want !== undefined || (await usdgOf(t.address)) >= 25_000_000n) { tin = t; break; }
if (!tin) throw new Error("no funded tin with ≥ 25 USDG and no cards (is the snapshot current?)");
const tinKey = wallet.keys.tin(tin.index).privateKey;
const send = (to: Address, data: Hex) => sendFromTin(api, chain, tinKey, { to, data });
const step = (s: string) => console.log(`• ${s}`);
const expectReject = async (what: string, p: Promise<unknown>, re: RegExp) => {
  const err = await p.then(() => null, (e: Error) => e);
  if (!err || !re.test(err.message)) throw new Error(`${what}: expected a refusal matching ${re}, got ${err ? err.message : "success"}`);
  step(`refused: ${what}`);
};
console.log(`tin ${tin.index} ${tin.address}: ${(await usdgOf(tin.address)) / 1_000_000n} USDG`);

// 1. The API's guard refuses what a malicious pack site might ask a tin to sign. (Needs USDG in
//    the tin, or gas estimation fails first; a rerun after the rip skips it.)
if ((await usdgOf(tin.address)) > 0n) {
  await expectReject("USDG transfer to an unknown address", send(usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [ATTACKER, 1n] })), /vault or a shipping payee/);
  await expectReject("unlimited approval", send(usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, 2n ** 256n - 1n] })), /unlimited/);
  await expectReject("approval to an unknown spender", send(usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ATTACKER, 1n] })), /unknown spender/);
}

// 2. Rip: approve the price, pay; the vault mints the pull into the tin. (A rerun on a tin that
//    already holds its pull skips this.)
const vaultAbi = [{ type: "function", name: "nextCard", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const;
const ownerAbi = [{ type: "function", name: "ownerOf", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" }] as const;
const ownerOf = (id: bigint) => (chain.readContract({ address: cards, abi: ownerAbi, functionName: "ownerOf", args: [id] }) as Promise<Address>).catch(() => null);
const lastCard = async () => ((await chain.readContract({ address: vault, abi: vaultAbi, functionName: "nextCard" })) as bigint) - 1n;
let cardId = await lastCard();
if ((await ownerOf(cardId))?.toLowerCase() !== tin.address.toLowerCase()) {
  await send(usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [vault, 25_000_000n] }));
  const paid = await send(vault, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [usdg, 25_000_000n, `foil-testnet-${Date.now()}`] }));
  step(`rip: ${paid.summary}`);
  cardId = await lastCard();
  if ((await ownerOf(cardId))?.toLowerCase() !== tin.address.toLowerCase()) throw new Error(`card ${cardId} is not in the tin`);
}
step(`card #${cardId} is in the tin`);
if (process.argv[3] === "keep") {
  console.log("kept the card in the tin (post it to a Rip Room from the web app)");
  process.exit(0);
}

// 3. Sell back against a signed quote (the live 0x60dee04b call shape).
await expectReject("card approval to someone else", send(cards, encodeFunctionData({ abi: CARD_ABI, functionName: "approve", args: [ATTACKER, cardId] })), /only be approved to the vault/);
await send(cards, encodeFunctionData({ abi: CARD_ABI, functionName: "approve", args: [vault, cardId] }));
const deadline = (await chain.getBlock()).timestamp + 600n;
const nonce = BigInt(Date.now());
const quoteSigner = privateKeyToAccount(env.CC_QUOTE_PRIVATE_KEY as Hex);
const quote = await quoteSigner.signMessage({ message: { raw: keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [tin.address, cardId, 20_000_000n, deadline, nonce],
)) } });
const beforeSale = await usdgOf(tin.address);
const sold = await send(vault, concatHex(["0x60dee04b", encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
  [usdg, cardId, 20_000_000n, deadline, nonce, quote],
)]));
step(`sell-back: ${sold.summary}`);
const after = await usdgOf(tin.address);
if (after !== beforeSale + 20_000_000n) throw new Error(`tin holds ${after}, expected ${beforeSale + 20_000_000n}`);
if ((await ownerOf(cardId))?.toLowerCase() !== vault.toLowerCase()) throw new Error("the vault did not take the card");

// 4. Return: everything in the tin goes back to the Stash, admitted at once as clean inbound.
await wallet.sync();
const before = wallet.balance;
await wallet.sendBack(tin, after);
await wallet.sync();
const admitted = await wallet.admitReady();
await wallet.sync();
if ((await usdgOf(tin.address)) !== 0n) throw new Error("the tin still holds USDG");
step(`returned ${after} to the Stash (${admitted} admitted); Stash ${before} → ${wallet.balance}`);
console.log("browser mode on testnet: ok");
process.exit(0);
