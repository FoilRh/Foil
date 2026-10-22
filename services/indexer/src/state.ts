/**
 * Indexer state (Build §1, §2, §11): the public tin set. Built only from public chain
 * logs; links nothing beyond what the chain already shows (a tin, its funding round,
 * its USDG balance and the cards it holds).
 */
import { parseEventLogs, type Address, type Log } from "viem";
import { stashPoolAbi } from "@foil/protocol";

const erc20Transfer = [{
  type: "event", name: "Transfer", inputs: [
    { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false },
  ],
}] as const;
const erc721Transfer = [{
  type: "event", name: "Transfer", inputs: [
    { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: true },
  ],
}] as const;

export interface TinEntry { tin: Address; roundId: string; funded: bigint; usdg: bigint; cards: Set<string>; sentBack: bigint; sendBacks: number }
/** `pool` ties a snapshot to one deployment, so a redeployed indexer never resumes from another's. */
export interface Snapshot { block: string; asOf: string; pool?: Address; tins: { tin: Address; roundId: string; funded: string; usdg: string; cards: string[] }[] }
export interface PoolEventRow { tx: string; logIndex: number; block: bigint; kind: string; size: bigint | null }

/** The public tin set, folded from pool, USDG and card-NFT logs; `snapshot()` is what gets published. */
export class TinSet {
  readonly tins = new Map<string, TinEntry>();
  /** USDG moves seen before a tin was known (e.g. same block) are replayed on discovery. */
  private pendingUsdg: { from: string; to: string; value: bigint }[] = [];
  poolEvents: PoolEventRow[] = [];
  block = 0n;

  constructor(private addrs: { pool: Address; usdg: Address; cardNft?: Address }) {}

  /** Apply logs in chain order (block, logIndex). */
  apply(logs: Log[]) {
    const sorted = [...logs].sort((a, b) => (a.blockNumber! === b.blockNumber! ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1));
    for (const l of sorted) {
      const addr = l.address.toLowerCase();
      if (addr === this.addrs.pool.toLowerCase()) this.pool(l);
      else if (addr === this.addrs.usdg.toLowerCase()) this.usdg(l);
      else if (this.addrs.cardNft && addr === this.addrs.cardNft.toLowerCase()) this.card(l);
      if (l.blockNumber! > this.block) this.block = l.blockNumber!;
    }
  }

  private pool(l: Log) {
    const [e] = parseEventLogs({ abi: stashPoolAbi, logs: [l] });
    if (!e) return;
    const a = e.args as Record<string, unknown>;
    const size = typeof a.size === "bigint" ? a.size : typeof a.gross === "bigint" ? a.gross : null;
    this.poolEvents.push({ tx: l.transactionHash!, logIndex: l.logIndex!, block: l.blockNumber!, kind: e.eventName, size });
    if (e.eventName === "EntryCreated" && Number(a.kind) === 1) {
      const t = this.tins.get((a.origin as Address).toLowerCase());
      if (t) {
        t.sentBack += a.gross as bigint;
        t.sendBacks += 1;
      }
    }
    if (e.eventName === "TinFunded") {
      const tin = (a.tin as Address).toLowerCase();
      const cur = this.tins.get(tin);
      if (cur) cur.funded += a.size as bigint;
      else {
        this.tins.set(tin, { tin: a.tin as Address, roundId: String(a.roundId), funded: a.size as bigint, usdg: 0n, cards: new Set(), sentBack: 0n, sendBacks: 0 });
        // The pool's USDG transfer to this tin is in the same tx, possibly just before.
        const replay = this.pendingUsdg.filter((t) => t.to === tin || t.from === tin);
        this.pendingUsdg = this.pendingUsdg.filter((t) => !(t.to === tin || t.from === tin));
        for (const t of replay) this.moveUsdg(t.from, t.to, t.value);
      }
    }
  }

  private usdg(l: Log) {
    const [e] = parseEventLogs({ abi: erc20Transfer, logs: [l] });
    if (!e) return;
    const from = e.args.from.toLowerCase();
    const to = e.args.to.toLowerCase();
    if (this.tins.has(from) || this.tins.has(to)) this.moveUsdg(from, to, e.args.value);
    else if (from === this.addrs.pool.toLowerCase()) this.pendingUsdg.push({ from, to, value: e.args.value });
  }

  private moveUsdg(from: string, to: string, value: bigint) {
    const f = this.tins.get(from);
    const t = this.tins.get(to);
    if (f) f.usdg -= value;
    if (t) t.usdg += value;
  }

  private card(l: Log) {
    const [e] = parseEventLogs({ abi: erc721Transfer, logs: [l] });
    if (!e) return;
    const id = e.args.tokenId.toString();
    this.tins.get(e.args.from.toLowerCase())?.cards.delete(id);
    this.tins.get(e.args.to.toLowerCase())?.cards.add(id);
  }

  /** Resume from a persisted snapshot plus the send-back counters stored beside it (tins_pub). */
  load(snap: Snapshot, sendBacks: Map<string, { sentBack: bigint; sendBacks: number }>) {
    for (const t of snap.tins) {
      const s = sendBacks.get(t.tin.toLowerCase());
      this.tins.set(t.tin.toLowerCase(), {
        tin: t.tin, roundId: t.roundId, funded: BigInt(t.funded), usdg: BigInt(t.usdg), cards: new Set(t.cards),
        sentBack: s?.sentBack ?? 0n, sendBacks: s?.sendBacks ?? 0,
      });
    }
    this.block = BigInt(snap.block);
  }

  /** Serializable snapshot (bigints as strings, tins sorted by address); drops unmatched pending USDG moves. */
  snapshot(asOf = new Date()): Snapshot {
    this.pendingUsdg = []; // anything still unmatched was not a tin funding
    return {
      block: this.block.toString(),
      asOf: asOf.toISOString(),
      pool: this.addrs.pool,
      tins: [...this.tins.values()]
        .map((t) => ({ tin: t.tin, roundId: t.roundId, funded: t.funded.toString(), usdg: t.usdg.toString(), cards: [...t.cards].sort() }))
        .sort((a, b) => (a.tin.toLowerCase() < b.tin.toLowerCase() ? -1 : 1)),
    };
  }
}
