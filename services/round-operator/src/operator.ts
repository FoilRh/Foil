/**
 * Round operator (Build §3.2): accepts (tin, salt) reveals, closes rounds on the
 * 10-minute rule and executes them with USDG + ETH in one transaction.
 * Never logs tins or salts.
 */
import type { Address, Hex, LocalAccount, PublicClient, WalletClient } from "viem";
import { TIN_SIZES_MICROS, decodeRequestRef, stashPoolAbi, tinCommitOf } from "@foil/protocol";
import { planExecution, type Reveal } from "./plan";
import { signReceipt, type Receipt } from "./receipt";
import type { RevealStore } from "./store";

export interface OperatorDeps {
  pool: Address;
  chainId: number;
  account: LocalAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  store: RevealStore;
  log?: (msg: string) => void;
}

const PENDING = 1;

/** A reveal the operator refuses on purpose; its message is safe to return. */
export class RevealRejected extends Error {}

/** Builds the round operator: `acceptReveal` (signed receipt), `admitDue`, and `tick` (close + execute rounds). */
export function createOperator(d: OperatorDeps) {
  const read = <T>(functionName: string, args: unknown[] = []) =>
    d.publicClient.readContract({ address: d.pool, abi: stashPoolAbi, functionName, args } as never) as Promise<T>;
  const log = d.log ?? (() => {});
  let nextToCheck = 1n;
  let admitFrom = 0n; // lowest entry seq that may still be pending

  /**
   * The pending request this reveal opens in this round, if any. Mirrors
   * StashPool._revealed: a settled commit of another size never hides a pending one.
   */
  async function locate(roundId: bigint, r: Reveal) {
    for (const size of TIN_SIZES_MICROS) {
      const commit = tinCommitOf(r.tin, r.salt, size, roundId);
      const ref = decodeRequestRef(await read<bigint>("requestOfCommit", [commit]));
      if (!ref || ref.roundId !== roundId) continue;
      const req = await read<{ state: number }>("getRequest", [roundId, BigInt(ref.reqIdx)]);
      if (req.state === PENDING) return { commit, reqIdx: ref.reqIdx };
    }
    return null;
  }

  const isPending = async (roundId: bigint, r: Reveal) => (await locate(roundId, r)) !== null;

  /**
   * Admit every pending entry whose standby has ended, in seq order (Build §3.1: anyone may).
   * Doing it here, for everyone, means a user's own client never has to, so admissions
   * cannot be lined up with that user's other activity. Flagged or refunded entries are
   * skipped; at most `max` admissions per call.
   */
  async function admitDue(max = 50) {
    const next = await read<bigint>("nextSeq");
    const now = (await d.publicClient.getBlock()).timestamp;
    let admitted = 0;
    let firstPending: bigint | null = null;
    let seq = admitFrom;
    for (; seq < next && admitted < max; seq++) {
      const e = await read<readonly [Address, number, number, bigint]>("entries", [seq]);
      if (Number(e[2]) !== PENDING) continue;
      if (e[3] > now) { firstPending ??= seq; continue; }
      try {
        await send("admitAfterStandby", [seq]);
        admitted++;
      } catch {
        firstPending ??= seq; // flagged or raced; looked at again next tick
      }
    }
    admitFrom = firstPending ?? seq;
    if (admitted) log(`admitted ${admitted} entries`);
    return admitted;
  }

  return {
    /** Validate a reveal against the chain, store it, and return a signed receipt. */
    async acceptReveal(roundId: bigint, r: Reveal): Promise<Receipt> {
      const loc = await locate(roundId, r);
      if (!loc) throw new RevealRejected("no pending request matches this reveal");
      await d.store.put(roundId, r);
      return signReceipt(d.account, d.chainId, d.pool, {
        roundId,
        tinCommit: loc.commit,
        // Chain time, not this server's clock: Bonds compares it with the round's closedAt,
        // and the client rejects a receipt dated after the chain's current time.
        receivedAt: (await d.publicClient.getBlock()).timestamp,
      });
    },

    admitDue,

    /** One pass: close the current round if allowed, then execute every closed round. */
    async tick() {
      await admitDue().catch((e) => log(`admit failed: ${(e as Error).message.slice(0, 120)}`));
      const current = await read<bigint>("currentRound");
      if (await read<boolean>("canClose", [current])) {
        await send("closeRound", []);
        log(`closed round ${current}`);
      }
      const latest = await read<bigint>("currentRound");
      if (latest - nextToCheck > 200n) nextToCheck = latest - 200n;
      const now = BigInt(Math.floor(Date.now() / 1000));
      for (let id = nextToCheck; id < latest; id++) {
        const [, closedAt] = await read<readonly [bigint, bigint, bigint, number]>("rounds", [id]);
        if (closedAt === 0n) continue;
        // One failing round must not stop the others.
        const done = await execute(id).catch((e) => (log(`round ${id} failed: ${(e as Error).message.slice(0, 120)}`), false));
        // Stop revisiting once executed, or once the liveness hour passed (users self-execute).
        if (id === nextToCheck && (done || now > closedAt + 3600n)) nextToCheck = id + 1n;
      }
    },
  };

  /** Funds every stored, still-pending reveal; true when nothing is left to fund. */
  async function execute(roundId: bigint): Promise<boolean> {
    const reveals = await d.store.list(roundId);
    const pending: Reveal[] = [];
    for (const r of reveals) if (await isPending(roundId, r)) pending.push(r);
    if (pending.length === 0) {
      await d.store.clear(roundId);
      return reveals.length > 0;
    }
    const { tins, salts } = planExecution(pending, () => true);
    const ethPerTin = await read<bigint>("ethPerTin");
    await send("executeRound", [roundId, tins, salts], ethPerTin * BigInt(tins.length));
    await d.store.clear(roundId);
    log(`executed round ${roundId}: ${tins.length} tins`);
    return true;
  }

  async function send(functionName: string, args: unknown[], value = 0n) {
    const hash = await d.walletClient.writeContract({
      address: d.pool, abi: stashPoolAbi, functionName, args, value, account: d.account, chain: null,
    } as never);
    const rcpt = await d.publicClient.waitForTransactionReceipt({ hash: hash as Hex });
    if (rcpt.status !== "success") throw new Error(`${functionName} reverted`);
  }
}
