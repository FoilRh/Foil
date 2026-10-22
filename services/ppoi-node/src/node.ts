/**
 * ppoi-node (Build §1, §3.1, §3.3): screens Stash entries.
 *   Deposit   clean if its origin is not on the provider's blocklist
 *   Send-back clean if every USDG transfer INTO the tin came from a clean-inbound source
 *             (the Stash pool, CC's GachaVault: ScreeningGate.cleanInbound)
 * A clean entry gets this node's signature over StashPool.admitDigest(seq); two
 * providers' signatures admit it at once. An entry that fails either rule is flagged on-chain.
 * The node also publishes its blocklist's sparse-Merkle root as an hourly heartbeat
 * (fresh roots set the 15-minute standby and back PPOI proofs).
 */
import type { Address, Hex, LocalAccount, PublicClient, WalletClient } from "viem";
import { parseAbiItem } from "viem";
import { screeningGateAbi, stashPoolAbi } from "@foil/protocol";
import { newMemEmptyTrie } from "circomlibjs";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const PENDING = 1;
const KIND_SEND_BACK = 1;

export interface NodeDeps {
  pool: Address;
  gate: Address;
  usdg: Address;
  startBlock: bigint;
  account: LocalAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  blocklist: Address[];
  /** Poseidon(address) for the SMT key; injected so tests and prod share circomlibjs. */
  poseidon: (x: bigint) => bigint;
}

/** Screening refusal; its message is safe to return to the caller (main.ts maps it to 422). */
export class Rejected extends Error {}

/** Builds a screening node: `attest(seq)`, `flagBlocked()`, `root()` and `publishRoot()`. */
export function createNode(d: NodeDeps) {
  const blocked = new Set(d.blocklist.map((a) => a.toLowerCase()));
  const read = <T>(address: Address, abi: unknown, functionName: string, args: unknown[] = []) =>
    d.publicClient.readContract({ address, abi, functionName, args } as never) as Promise<T>;

  async function entry(seq: bigint) {
    const e = await read<readonly [Address, number, number, bigint, bigint, bigint, bigint]>(d.pool, stashPoolAbi, "entries", [seq]);
    return { origin: e[0], kind: Number(e[1]), state: Number(e[2]) };
  }

  /**
   * A send-back is clean when everything the tin has sent back so far (this entry
   * included) is covered by USDG it received from clean-inbound sources, and no sender was
   * blocklisted. Other outside inbound does not taint it: anyone can send dust to a public
   * tin, and that must not get the owner's own funds flagged.
   */
  async function inboundClean(tin: Address) {
    const logs = await d.publicClient.getLogs({ address: d.usdg, event: transferEvent, args: { to: tin }, fromBlock: d.startBlock });
    const isClean = new Map<string, boolean>();
    let clean = 0n;
    for (const l of logs) {
      const s = (l.args.from as Address).toLowerCase();
      if (blocked.has(s)) return false;
      if (!isClean.has(s)) isClean.set(s, await read<boolean>(d.gate, screeningGateAbi, "cleanInbound", [s]));
      if (isClean.get(s)) clean += l.args.value as bigint;
    }
    const sentBack = await read<bigint>(d.pool, stashPoolAbi, "tinSentBack", [tin]);
    return clean > 0n && sentBack <= clean;
  }

  /** Why an entry is not clean (null if it is). The one screening rule, for attest and flagBlocked alike. */
  async function unclean(e: { origin: Address; kind: number }): Promise<string | null> {
    if (blocked.has(e.origin.toLowerCase())) return "origin is blocklisted";
    if (e.kind === KIND_SEND_BACK && !(await inboundClean(e.origin))) return "send-back exceeds what the tin received from clean sources";
    return null;
  }

  return {
    address: d.account.address,

    /** Signature over admitDigest(seq) if the entry is pending and clean. */
    async attest(seq: bigint): Promise<Hex> {
      const e = await entry(seq);
      if (e.state !== PENDING) throw new Rejected("entry is not pending");
      const why = await unclean(e);
      if (why) throw new Rejected(why);
      const digest = await read<Hex>(d.pool, stashPoolAbi, "admitDigest", [seq]);
      return d.account.signMessage({ message: { raw: digest } });
    },

    /**
     * Flag pending entries that fail screening (scans the last `lookback` entries): blocklisted
     * origins, and send-backs whose tin took USDG from outside the clean set. Unflagged, either
     * would be admitted by admitAfterStandby once the standby ends.
     */
    async flagBlocked(lookback = 500n): Promise<bigint[]> {
      const next = await read<bigint>(d.pool, stashPoolAbi, "nextSeq");
      const flagged: bigint[] = [];
      for (let seq = next > lookback ? next - lookback : 0n; seq < next; seq++) {
        const e = await entry(seq);
        if (e.state === PENDING && (await unclean(e))) {
          const hash = await d.walletClient.writeContract({ address: d.pool, abi: stashPoolAbi, functionName: "flag", args: [seq], account: d.account, chain: null } as never);
          await d.publicClient.waitForTransactionReceipt({ hash });
          flagged.push(seq);
        }
      }
      return flagged;
    },

    /** Sparse-Merkle root of the blocklist, keyed by Poseidon(address) (circuits/src/ppoi.circom). */
    async root(): Promise<bigint> {
      const smt = await newMemEmptyTrie();
      for (const a of blocked) await smt.insert(smt.F.e(d.poseidon(BigInt(a))), smt.F.e(1n));
      return smt.F.toObject(smt.root);
    },

    /** Heartbeat: publish the current root (keeps this provider "fresh"). */
    async publishRoot(): Promise<bigint> {
      const root = await this.root();
      const hash = await d.walletClient.writeContract({ address: d.gate, abi: screeningGateAbi, functionName: "updateRoot", args: [root], account: d.account, chain: null } as never);
      await d.publicClient.waitForTransactionReceipt({ hash });
      return root;
    },
  };
}
