/**
 * Browser mode (Build §5A, §12 "Rip") at the API level, against a CC stand-in with the
 * live call shapes: a round-funded tin approves and pays for a pack, receives the card,
 * sells it back against a signed quote, and returns everything to the Stash — every
 * transaction signed by the tin and relayed by the API's guarded broadcast over OHTTP.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { concatHex, createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { screeningGateAbi, stashPoolAbi, usdgAbi } from "@foil/protocol";
import { CARD_ABI, CC_ABI, ERC20_ABI } from "@foil/guard";
import { Wallet, emptyState, keysFromMnemonic, loadCrypto, sendFromTin, type Prover, type TinRec } from "@foil/client";
import { ANVIL_KEYS, hasFoundry, setTime } from "../scripts/devchain";
import { startStack } from "./harness";

const stubProver: Prover = async () => ({ a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] });
const ATTACKER = "0xbadbadbadbadbadbadbadbadbadbadbadbadbad0" as Address;

describe.skipIf(!hasFoundry())("browser mode: rip, sell back, return — through the guarded broadcast", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  let wallet: Wallet;
  let tin: TinRec;
  let tinKey: Hex;
  const deployer = privateKeyToAccount(ANVIL_KEYS[0]!); // gate/pool owner and CC quote signer in dev
  const outside = privateKeyToAccount(ANVIL_KEYS[4]!);

  const as = async (account: typeof deployer, address: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const w = createWalletClient({ transport: http(s.chain.rpc), account });
    await s.publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, chain: null } as never) });
  };
  const usdgOf = (a: Address) => s.publicClient.readContract({ address: s.chain.deployment.usdg, abi: usdgAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
  const send = (to: Address, data: Hex) => sendFromTin(s.api, s.chainClient as never, tinKey, { to, data });

  beforeAll(async () => {
    s = await startStack({ port: 8617, mockVerifiers: true, cc: true });
    // Enough round ETH for a few CC transactions; the vault's payouts count as clean inbound.
    await as(deployer, s.chain.deployment.pool, stashPoolAbi, "setParams", [1_000_000n, 2_000_000_000_000_000n]);
    await as(deployer, s.chain.deployment.gate, screeningGateAbi, "setCleanInbound", [s.vault!.address, true]);

    const c = await loadCrypto();
    const cfg = await s.api.config.query();
    wallet = new Wallet(c, keysFromMnemonic(c, "test test test test test test test test test test test junk"), s.api, s.chainClient as never, {
      chainId: cfg.chainId, pool: cfg.pool as Address, usdg: cfg.usdg as Address, poolId: BigInt(cfg.poolId),
      relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock: 0n, admitJitterMs: 0, selfAdmitAfterSec: 0,
    }, stubProver, emptyState(0n));

    await as(outside, s.chain.deployment.usdg, usdgAbi, "mint", [outside.address, 100_000_000n]);
    await as(outside, s.chain.deployment.usdg, usdgAbi, "approve", [s.chain.deployment.pool, 100_000_000n]);
    const d = wallet.depositArgs(100_000_000n);
    await as(outside, s.chain.deployment.pool, stashPoolAbi, "deposit", [d.amount, d.npk, d.ciphertext, d.epk]);
    await wallet.sync();
    await wallet.admitReady();
    await wallet.sync();

    tin = await wallet.requestTin(50);
    await setTime(s.chain.rpc, Number((await s.publicClient.getBlock()).timestamp) + 31 * 60);
    await s.operator.tick();
    tinKey = wallet.keys.tin(tin.index).privateKey;
    expect(await usdgOf(tin.address)).toBe(50_000_000n);
  }, 180_000);
  afterAll(() => s?.chain.stop());

  test("the guard refuses malicious transactions server-side", async () => {
    await expect(send(s.chain.deployment.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [ATTACKER, 1n] }))).rejects.toThrow(/vault or a shipping payee/);
    await expect(send(s.chain.deployment.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [s.vault!.address, 2n ** 256n - 1n] }))).rejects.toThrow(/unlimited/);
    await expect(send(s.chain.deployment.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ATTACKER, 1n] }))).rejects.toThrow(/unknown spender/);
  });

  test("rip: approve the price, pay, and the card lands in the tin", async () => {
    await send(s.chain.deployment.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [s.vault!.address, 25_000_000n] }));
    const r = await send(s.vault!.address, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [s.chain.deployment.usdg, 25_000_000n, "memo-1"] }));
    expect(r.summary).toContain("−$25.00 USDG");
    expect(await usdgOf(tin.address)).toBe(25_000_000n);
    const owner = await s.publicClient.readContract({ address: s.cards!.address, abi: s.cards!.abi as never, functionName: "ownerOf", args: [1000n] });
    expect(owner).toBe(tin.address);
  }, 60_000);

  test("sell back against a signed quote (the live 0x60dee04b call shape)", async () => {
    await expect(send(s.cards!.address, encodeFunctionData({ abi: CARD_ABI, functionName: "approve", args: [ATTACKER, 1000n] }))).rejects.toThrow(/only be approved to the vault/);
    await send(s.cards!.address, encodeFunctionData({ abi: CARD_ABI, functionName: "approve", args: [s.vault!.address, 1000n] }));
    const deadline = BigInt(Number((await s.publicClient.getBlock()).timestamp) + 600);
    const quote = await deployer.signMessage({ message: { raw: keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [tin.address, 1000n, 20_000_000n, deadline, 7n],
    )) } });
    const data = concatHex(["0x60dee04b", encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
      [s.chain.deployment.usdg, 1000n, 20_000_000n, deadline, 7n, quote],
    )]);
    const r = await send(s.vault!.address, data);
    expect(r.summary).toContain("+$20.00 USDG");
    expect(await usdgOf(tin.address)).toBe(45_000_000n);
  }, 60_000);

  test("return: the tin's USDG goes back to the Stash, admitted at once as clean inbound", async () => {
    await wallet.sync(); // the Stash after the tin request (sync, not the pre-request cache)
    const before = wallet.balance;
    await wallet.sendBack(tin, 45_000_000n);
    await wallet.sync();
    expect(await wallet.admitReady()).toBe(1); // inbound only from the pool and the vault
    await wallet.sync();
    // Free up to the funded $50; nothing above it.
    expect(wallet.balance).toBe(before + 45_000_000n);
    expect(await usdgOf(tin.address)).toBe(0n);
  }, 60_000);

});
