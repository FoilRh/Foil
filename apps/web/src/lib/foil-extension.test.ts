/**
 * The dashboard ↔ extension bridge, end to end without Chrome: a fake extension port runs
 * the real extension decision logic (apps/extension core.decide); the real bridge runs
 * against the anvil stack with the CC stand-in. Covers Build §5A.2: one tin per rip,
 * spend recorded when the card lands, tin retired, pause when no ready tin is left.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWalletClient, encodeFunctionData, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stashPoolAbi, usdgAbi } from "@foil/protocol";
import { CC_ABI, ERC20_ABI } from "@foil/guard";
import { Wallet, emptyState, keysFromMnemonic, loadCrypto, type Prover } from "@foil/client";
import { decide, fromWire, type Session, type WirePolicy } from "../../../extension/src/core";
import { ANVIL_KEYS, hasFoundry, setTime } from "../../../../scripts/devchain";
import { startStack } from "../../../../e2e/harness";

process.env.NEXT_PUBLIC_FOIL_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const stubProver: Prover = async () => ({ a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] });
const SITE = "https://gacha.collectorcrypt.com";

describe.skipIf(!hasFoundry())("ripping through the extension bridge", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  let wallet: Wallet;
  const session: Session = { policy: null, pausedReason: null };
  const replies = new Map<number, { result?: unknown; error?: string }>();
  let deliver: ((m: Record<string, unknown>) => void) | null = null;
  let seq = 0;
  let bridge: typeof import("./foil-extension");
  let workspace: typeof import("./foil-workspace");

  // A fake extension: stores the session the app hands it, and forwards reads/signs.
  const fakePort = {
    postMessage(m: Record<string, unknown>) {
      if (m.type === "session") {
        session.policy = m.policy ? fromWire(m.policy as WirePolicy) : null;
        session.pausedReason = (m.reason as string) ?? null;
      } else if (m.type === "reply") replies.set(m.id as number, { result: m.result, error: m.error as string | undefined });
    },
    onMessage: { addListener: (fn: (m: Record<string, unknown>) => void) => void (deliver = fn) },
    onDisconnect: { addListener: () => {} },
    disconnect() {},
  };
  /** What a pack site's provider call does, end to end (auto-approving confirmations). */
  async function site(method: string, params: unknown[]) {
    const d = decide(session, SITE, method, params);
    if (d.kind === "result") return d.result;
    if (d.kind === "error") throw new Error(d.message);
    const id = ++seq;
    deliver!({ type: d.kind === "read" ? "read" : "sign", id, method, params, origin: SITE });
    for (let i = 0; i < 600 && !replies.has(id); i++) await Bun.sleep(50);
    const r = replies.get(id)!;
    if (r.error) throw new Error(r.error);
    return r.result;
  }

  beforeAll(async () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: { connect: () => fakePort } };
    bridge = await import("./foil-extension");
    workspace = await import("./foil-workspace");
    workspace.updateRegion("US");

    s = await startStack({ port: 8618, mockVerifiers: true, cc: true });
    const deployer = privateKeyToAccount(ANVIL_KEYS[0]!);
    const outside = privateKeyToAccount(ANVIL_KEYS[4]!);
    const as = async (account: typeof deployer, address: Address, abi: unknown, functionName: string, args: unknown[]) => {
      const w = createWalletClient({ transport: http(s.chain.rpc), account });
      await s.publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, chain: null } as never) });
    };
    await as(deployer, s.chain.deployment.pool, stashPoolAbi, "setParams", [1_000_000n, 2_000_000_000_000_000n]);
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
    await wallet.requestTin(25);
    await setTime(s.chain.rpc, Number((await s.publicClient.getBlock()).timestamp) + 31 * 60);
    await s.operator.tick();
    await wallet.sync();
    const t = wallet.state.tins[0]!;
    wallet.state = { ...wallet.state, tins: [{ ...t, state: "Funded", usdg: "25000000" }] };
  }, 180_000);
  afterAll(() => {
    bridge?.stopRipping();
    s?.chain.stop();
  });

  test("start: the site sees exactly one fresh tin, on RHC", async () => {
    await bridge.startRipping(wallet);
    expect(await site("eth_requestAccounts", [])).toEqual([wallet.state.tins[0]!.address]);
    expect(await site("eth_chainId", [])).toBe("0x1237");
  }, 60_000);

  test("an attack from the site is blocked before the app is even asked", async () => {
    const tin = session.policy!.tin;
    await expect(site("eth_sendTransaction", [{ from: tin, to: s.chain.deployment.usdg, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: ["0xbadbadbadbadbadbadbadbadbadbadbadbadbad0", 1n] }) }])).rejects.toThrow(/blocked/);
  });

  test("rip: approve + pay; the card lands; spend recorded; tin retired; no tin left → pause", async () => {
    const tin = session.policy!.tin;
    await site("eth_sendTransaction", [{ from: tin, to: s.chain.deployment.usdg, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [s.vault!.address, 20_000_000n] }) }]);
    await site("eth_sendTransaction", [{ from: tin, to: s.vault!.address, data: encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [s.chain.deployment.usdg, 20_000_000n, "memo"] }) }]);
    for (let i = 0; i < 100 && session.policy; i++) await Bun.sleep(200); // the bridge polls every 5s
    expect(session.policy).toBeNull();
    expect(session.pausedReason).toContain("Next tin arrives");
    expect(wallet.state.tins[0]!.ripped).toBe(true);
    const spend = workspace.currentPrefs().spends;
    expect(spend.some((x) => x.amount === 20)).toBe(true);
    await expect(site("eth_requestAccounts", [])).rejects.toThrow(/Next tin arrives/);
  }, 60_000);
});
