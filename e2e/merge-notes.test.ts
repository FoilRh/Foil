/**
 * A spend proves at most two notes. A Stash held in three notes (4 + 10 + 14 USDG deposits)
 * must still fund a $25 tin: the wallet merges the two smallest it needs into one, then
 * requests. And when even every note together falls short, nothing is spent.
 * Mock verifiers + a stub prover keep it fast.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stashPoolAbi, usdgAbi } from "@foil/protocol";
import { Wallet, emptyState, keysFromMnemonic, loadCrypto, type Prover } from "@foil/client";
import { ANVIL_KEYS, hasFoundry } from "../scripts/devchain";
import { startStack } from "./harness";

const stubProver: Prover = async () => ({ a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] });
const unspent = (w: Wallet) => w.state.notes.filter((n) => !n.spent && BigInt(n.amount) > 0n);

describe.skipIf(!hasFoundry())("spends that need more than two notes", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  let w: Wallet;
  const outside = privateKeyToAccount(ANVIL_KEYS[4]!);

  beforeAll(async () => {
    s = await startStack({ port: 8619, mockVerifiers: true });
    const c = await loadCrypto();
    const cfg = await s.api.config.query();
    w = new Wallet(c, keysFromMnemonic(c, "test test test test test test test test test test test junk"), s.api, s.chainClient as never, {
      chainId: cfg.chainId, pool: cfg.pool as Address, usdg: cfg.usdg as Address, poolId: BigInt(cfg.poolId),
      relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock: 0n, admitJitterMs: 0, selfAdmitAfterSec: 0,
    }, stubProver, emptyState(0n));
    const ow = createWalletClient({ transport: http(s.chain.rpc), account: outside });
    const send = async (address: Address, abi: unknown, functionName: string, args: unknown[]) =>
      s.publicClient.waitForTransactionReceipt({ hash: await ow.writeContract({ address, abi, functionName, args, chain: null } as never) });
    await send(s.chain.deployment.usdg, usdgAbi, "mint", [outside.address, 28_000_000n]);
    await send(s.chain.deployment.usdg, usdgAbi, "approve", [s.chain.deployment.pool, 28_000_000n]);
    for (const amount of [4_000_000n, 10_000_000n, 14_000_000n]) {
      const d = w.depositArgs(amount);
      await send(s.chain.deployment.pool, stashPoolAbi, "deposit", [d.amount, d.npk, d.ciphertext, d.epk]);
      await w.sync();
      expect(await w.admitReady()).toBe(1);
      await w.sync();
    }
    expect(unspent(w).length).toBe(3);
  }, 180_000);
  afterAll(() => s?.chain.stop());

  test("too little in all notes together: refused before any merge is paid for", async () => {
    await expect(w.requestTin(50)).rejects.toThrow(/Not enough/);
    expect(unspent(w).length).toBe(3); // no merge spent a relayer fee
  }, 60_000);

  test("a $25 tin from three notes: the two smallest are merged, then the tin is requested", async () => {
    const before = unspent(w).map((n) => BigInt(n.amount)).sort((a, b) => (a < b ? -1 : 1));
    const t = await w.requestTin(25);
    expect(t.state).toBe("Requested");
    await w.sync();
    // The merge consumed the 4 and 10 notes; the request then spent the merged note and the 14.
    expect(w.state.notes.filter((n) => n.spent && BigInt(n.amount) === before[0]!).length).toBe(1);
    expect(w.state.notes.filter((n) => n.spent && BigInt(n.amount) === before[1]!).length).toBe(1);
    const fee = BigInt((await s.api.config.query()).relayerFeeFloor);
    const reserved = BigInt(t.reserved);
    const left = unspent(w).reduce((x, n) => x + BigInt(n.amount), 0n);
    expect(left).toBe(before.reduce((x, n) => x + n, 0n) - reserved - 2n * fee); // one merge + one request fee
  }, 120_000);
});
