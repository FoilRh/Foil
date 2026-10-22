/**
 * Build §14 smoke test, Phase 1 steps (no ripping), with REAL verifiers and proofs,
 * the wallet talking only over OHTTP:
 *   deposit $30 → admit → request a $25 tin → round executes (tin holds USDG + ETH)
 *   → send the tin back to the Stash → withdraw → exitPending on a fresh deposit
 *   → exits still work with the guardian pause on.
 * Needs `bun run setup:dev` in circuits/ (proving keys) and Foundry.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stashPoolAbi, usdgAbi } from "@foil/protocol";
import { Wallet, emptyState, keysFromMnemonic, loadCrypto, localProver, type Artifacts, type TinRec, type TinSnapshot } from "@foil/client";
import { ANVIL_KEYS, hasFoundry, setTime } from "../scripts/devchain";
import { createIndexer } from "../services/indexer/src/indexer";
import { startStack } from "./harness";

const art = (f: string) => join(import.meta.dir, "..", "circuits", "build", "artifacts", f);
const ready = hasFoundry() && existsSync(art("joinsplit.zkey")) && existsSync(art("tin_request.zkey"));
const artifacts: Artifacts = { load: async (n) => ({ wasm: art(`${n}.wasm`), zkey: art(`${n}.zkey`) }) };
const MNEMONIC = "test test test test test test test test test test test junk";

describe.skipIf(!ready)("Phase 1 smoke test (real proofs)", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  let wallet: Wallet;
  const outside = privateKeyToAccount(ANVIL_KEYS[4]!); // the user's ordinary public wallet
  const bob = "0x000000000000000000000000000000000000b0b0" as Address;
  let tin: TinRec;

  const now = async () => Number((await s.publicClient.getBlock()).timestamp);
  const later = async (secs: number) => setTime(s.chain.rpc, (await now()) + secs);
  const usdgOf = (a: Address) => s.publicClient.readContract({ address: s.chain.deployment.usdg, abi: usdgAbi, functionName: "balanceOf", args: [a] });
  const outsideWrite = async (address: Address, abi: unknown, functionName: string, args: unknown[]) => {
    const w = createWalletClient({ transport: http(s.chain.rpc), account: outside });
    const hash = await w.writeContract({ address, abi, functionName, args, chain: null } as never);
    return s.publicClient.waitForTransactionReceipt({ hash });
  };
  const deposit = async (amount: bigint) => {
    const d = wallet.depositArgs(amount);
    await outsideWrite(s.chain.deployment.pool, stashPoolAbi, "deposit", [d.amount, d.npk, d.ciphertext, d.epk]);
  };

  beforeAll(async () => {
    s = await startStack({ port: 8613, mockVerifiers: false });
    const c = await loadCrypto();
    const cfg = await s.api.config.query();
    wallet = new Wallet(c, keysFromMnemonic(c, MNEMONIC), s.api, s.chainClient as never, {
      chainId: cfg.chainId, pool: cfg.pool as Address, usdg: cfg.usdg as Address, poolId: BigInt(cfg.poolId),
      relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock: 0n, admitJitterMs: 0, selfAdmitAfterSec: 0,
    }, localProver(artifacts), emptyState(0n));
    await outsideWrite(s.chain.deployment.usdg, usdgAbi, "mint", [outside.address, 1_000_000_000n]);
    await outsideWrite(s.chain.deployment.usdg, usdgAbi, "approve", [s.chain.deployment.pool, 2n ** 255n]);
  }, 180_000);
  afterAll(() => s?.chain.stop());

  test("1. deposit $30, admitted after standby", async () => {
    await deposit(30_000_000n);
    await wallet.sync();
    expect(wallet.pending).toBe(30_000_000n);
    await later(3600);
    expect(await wallet.admitReady()).toBe(1);
    await wallet.sync();
    expect(wallet.balance).toBe(30_000_000n - 45_000n);
  }, 120_000);

  test("2–3. request a $25 tin; the round executes; the tin holds USDG + ETH", async () => {
    tin = await wallet.requestTin(25);
    expect(tin.receipt).toBeDefined();
    await later(31 * 60);
    await s.operator.tick();
    await wallet.sync();
    expect(wallet.state.tins[0]!.state).toBe("Funded");
    expect(await usdgOf(tin.address)).toBe(25_000_000n);
    expect(await s.publicClient.getBalance({ address: tin.address })).toBeGreaterThan(0n);
    // change: 29.955 − (25 + 0.0375 + 0.20 + 1.00 gas) − 0.25 relayer
    expect(wallet.balance).toBe(29_955_000n - 26_237_500n - 250_000n);
  }, 180_000);

  test("3b. the indexer publishes the tin set; a restored wallet finds its tin locally", async () => {
    const indexer = createIndexer(s.publicClient as never, {
      pool: s.chain.deployment.pool, usdg: s.chain.deployment.usdg, startBlock: 0n, confirmations: 0n,
    });
    await indexer.catchUp();
    s.stores.setSnapshot(indexer.set.snapshot());
    const snap = (await s.api.snapshot.query()) as TinSnapshot;
    expect(snap.tins).toHaveLength(1);
    expect(snap.tins[0]!.usdg).toBe("25000000");

    const c = await loadCrypto();
    const restored = new Wallet(c, keysFromMnemonic(c, MNEMONIC), s.api, s.chainClient as never, wallet.cfg, localProver(artifacts), emptyState(0n));
    expect(restored.discover(snap)).toBe(1);
    expect(restored.state.tins[0]!.address).toBe(tin.address);
    expect(restored.state.tins[0]!.usdg).toBe("25000000");
    expect(restored.state.nextTin).toBe(1);
  }, 120_000);

  test("4. send the tin back to the Stash (free up to its funded amount)", async () => {
    const before = wallet.balance;
    await wallet.sendBack(tin, 25_000_000n);
    await wallet.sync();
    await later(3600);
    expect(await wallet.admitReady()).toBe(1);
    await wallet.sync();
    expect(wallet.balance).toBe(before + 25_000_000n);
    expect(await usdgOf(tin.address)).toBe(0n);

    // Snapshot diff since the earlier snapshot: just this tin, now empty.
    const earlier = (await s.api.snapshot.query())!;
    const indexer = createIndexer(s.publicClient as never, { pool: s.chain.deployment.pool, usdg: s.chain.deployment.usdg, startBlock: 0n, confirmations: 0n });
    await indexer.catchUp();
    s.stores.setSnapshot(indexer.set.snapshot());
    const d = await s.api.snapshotDiff.query({ since: earlier.block });
    expect(d?.kind).toBe("diff");
    expect(d?.kind === "diff" && d.changed.map((t) => [t.tin, t.usdg])).toEqual([[tin.address, "0"]]);
  }, 180_000);

  test("5. withdraw $10 to an outside wallet", async () => {
    await wallet.withdraw(10_000_000n, bob);
    expect(await usdgOf(bob)).toBe(10_000_000n - 25_000n);
    await wallet.sync();
  }, 180_000);

  test("6. exitPending refunds a fresh deposit to its origin", async () => {
    const before = await usdgOf(outside.address);
    await deposit(5_000_000n);
    await wallet.sync();
    const seq = BigInt(wallet.state.entries.find((e) => e.state === "Pending")!.seq);
    const deadline = BigInt((await now()) + 3600);
    const digest = (await s.chainClient.readContract({ address: s.chain.deployment.pool, abi: stashPoolAbi, functionName: "exitDigest", args: [seq, deadline] })) as `0x${string}`;
    const sig = await outside.sign({ hash: digest });
    await s.api.relay.mutate({ fn: "exitPending", args: [seq.toString(), deadline.toString(), sig] });
    expect(await usdgOf(outside.address)).toBe(before);
  }, 120_000);

  test("7. with the guardian pause on, withdrawals still work and new requests stop", async () => {
    const deployer = privateKeyToAccount(ANVIL_KEYS[0]!); // guardian in the dev deployment
    const w = createWalletClient({ transport: http(s.chain.rpc), account: deployer });
    await s.publicClient.waitForTransactionReceipt({
      hash: await w.writeContract({ address: s.chain.deployment.pool, abi: stashPoolAbi, functionName: "pause", args: [true, true], chain: null }),
    });
    await wallet.sync();
    await expect(wallet.requestTin(10)).rejects.toThrow(/RequestsPaused/);
    const before = await usdgOf(bob);
    await wallet.withdraw(1_000_000n, bob);
    expect((await usdgOf(bob)) - before).toBe(1_000_000n - 2_500n);
  }, 180_000);

  test("the relay saw only ciphertext", () => {
    expect([...s.seen.relayHeaders]).toEqual(["content-type"]);
    expect(s.seen.gatewayCalls).toBeGreaterThan(10);
  });
});
