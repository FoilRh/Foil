/**
 * Pack gift links (Build §6) across two wallets, through the full OHTTP stack:
 * giver funds a gift tin → link (key only in the fragment) → recipient claims into their
 * own Stash (admitted at once as clean-inbound) → giver's snapshot shows it claimed.
 * Mock verifiers + a stub prover keep it fast; real proofs are covered by smoke.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { stashPoolAbi, usdgAbi } from "@foil/protocol";
import {
  Wallet, decodeGiftFragment, emptyState, encodeGiftLink, keysFromMnemonic, loadCrypto, type Prover, type TinSnapshot,
} from "@foil/client";
import { ANVIL_KEYS, hasFoundry, setTime } from "../scripts/devchain";
import { createIndexer } from "../services/indexer/src/indexer";
import { startStack } from "./harness";

const stubProver: Prover = async () => ({ a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] });
const GIVER = "test test test test test test test test test test test junk";
const RECIPIENT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe.skipIf(!hasFoundry())("gift links", () => {
  let s: Awaited<ReturnType<typeof startStack>>;
  let giver: Wallet;
  let recipient: Wallet;
  const outside = privateKeyToAccount(ANVIL_KEYS[4]!);

  const later = async (secs: number) => setTime(s.chain.rpc, Number((await s.publicClient.getBlock()).timestamp) + secs);
  const snapshot = async () => {
    const ix = createIndexer(s.publicClient as never, { pool: s.chain.deployment.pool, usdg: s.chain.deployment.usdg, startBlock: 0n, confirmations: 0n });
    await ix.catchUp();
    s.stores.setSnapshot(ix.set.snapshot());
    return (await s.api.snapshot.query()) as TinSnapshot;
  };

  beforeAll(async () => {
    s = await startStack({ port: 8615, mockVerifiers: true });
    const c = await loadCrypto();
    const cfg = await s.api.config.query();
    const wcfg = {
      chainId: cfg.chainId, pool: cfg.pool as Address, usdg: cfg.usdg as Address, poolId: BigInt(cfg.poolId),
      relayer: cfg.relayer as Address, relayerFee: BigInt(cfg.relayerFeeFloor), startBlock: 0n, admitJitterMs: 0, selfAdmitAfterSec: 0,
    };
    giver = new Wallet(c, keysFromMnemonic(c, GIVER), s.api, s.chainClient as never, wcfg, stubProver, emptyState(0n));
    recipient = new Wallet(c, keysFromMnemonic(c, RECIPIENT), s.api, s.chainClient as never, wcfg, stubProver, emptyState(0n));

    // Giver's Stash: a $50 deposit from their outside wallet, admitted by the ppoi-nodes.
    const w = createWalletClient({ transport: http(s.chain.rpc), account: outside });
    const send = async (address: Address, abi: unknown, functionName: string, args: unknown[]) =>
      s.publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args, chain: null } as never) });
    await send(s.chain.deployment.usdg, usdgAbi, "mint", [outside.address, 50_000_000n]);
    await send(s.chain.deployment.usdg, usdgAbi, "approve", [s.chain.deployment.pool, 50_000_000n]);
    const d = giver.depositArgs(50_000_000n);
    await send(s.chain.deployment.pool, stashPoolAbi, "deposit", [d.amount, d.npk, d.ciphertext, d.epk]);
    await giver.sync();
    expect(await giver.admitReady()).toBe(1);
    await giver.sync();
  }, 120_000);
  afterAll(() => s?.chain.stop());

  test("giver funds a $10 gift tin and shares a fragment-only link; recipient claims it", async () => {
    const t = await giver.requestTin(10);
    giver.markGift(t.index, "For your first rip");
    await later(31 * 60);
    await s.operator.tick();
    await giver.sync();
    giver.discover(await snapshot());
    const g = giver.state.tins.find((x) => x.index === t.index)!;
    expect(g.state).toBe("Funded");
    expect(g.usdg).toBe("10000000");
    expect(g.gift?.note).toBe("For your first rip");

    const link = encodeGiftLink("https://foil.example", giver.keys.tin(t.index).privateKey, g.gift!.note);
    const parsed = decodeGiftFragment(new URL(link).hash)!;
    expect(parsed.address).toBe(g.address);

    // Recipient: claim the full balance into their own Stash.
    await recipient.claimGift(parsed.key, 10_000_000n);
    await recipient.sync();
    expect(await recipient.admitReady()).toBe(1); // clean-inbound: the tin only ever received from the pool
    await recipient.sync();
    expect(recipient.balance).toBe(10_000_000n); // free up to the tin's funded amount

    // Giver: the public snapshot shows the gift tin emptied, i.e. claimed.
    giver.discover(await snapshot());
    expect(giver.state.tins.find((x) => x.index === t.index)!.usdg).toBe("0");
    // And the link is spent: a second claim cannot move anything.
    await expect(recipient.claimGift(parsed.key, 10_000_000n)).rejects.toThrow();
  }, 180_000);
});
