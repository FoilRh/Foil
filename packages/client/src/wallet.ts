/**
 * The Foil wallet: syncs public pool events, finds its own notes by trial decryption
 * (then re-checks each commitment), and builds, proves and relays every Phase 1
 * action. All network traffic goes through the OHTTP transport.
 */
import {
  bytesToHex, encodeAbiParameters, keccak256, parseEventLogs, recoverTypedDataAddress, type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDG, decodeRequestRef, stashPoolAbi, toJson, type TinSize } from "@foil/protocol";
import { MerkleTree, commitmentOf, nullifierOf, npkOf, randomField, type Crypto } from "./crypto";
import type { Keys } from "./keys";
import { signPost } from "./rooms";
import { decryptNote, encryptNote, joinBlob, splitBlob } from "./notes";
import { prove, type SolidityProof } from "./prover";
import { buildJoinsplit, buildTinRequest, type OwnedNote } from "./spend";
import type { Api } from "./transport/api";

export interface Artifacts {
  load(name: "joinsplit" | "tin_request"): Promise<{ wasm: string | Uint8Array; zkey: string | Uint8Array }>;
}

/** Proves on the device. Browsers pass a Web Worker-backed prover; Bun/Node use artifacts directly. */
export type Prover = (name: "joinsplit" | "tin_request", input: Record<string, unknown>) => Promise<SolidityProof>;

/** Prover that loads circuit artifacts and runs snarkjs in-process (Bun/Node, tests). */
export const localProver = (artifacts: Artifacts): Prover => async (name, input) => {
  const a = await artifacts.load(name);
  return (await prove(input, a.wasm, a.zkey)).proof;
};

export interface WalletConfig {
  chainId: number;
  pool: Address;
  usdg: Address;
  poolId: bigint;
  relayer: Address;
  relayerFee: bigint;
  startBlock: bigint;
  /** Random wait before each admission, so a relayer's nonces do not line up a deposit
   * with our other entries (default 5 s; tests pass 0). */
  admitJitterMs?: number;
  /** The round operator admits entries once their standby ends (services/round-operator
   * admitDue). The wallet only does it itself if that has not happened this long after
   * (default 600 s; tests pass 0). */
  selfAdmitAfterSec?: number;
  /** Slack allowed on an operator receipt's receivedAt over the chain's time (default 15 s, one block or so). */
  receiptSkewSec?: number;
}

export interface NoteRec { leaf: number; amount: string; rho: string; spent: boolean }
export type TinState = "Requested" | "Funded" | "Cancelled" | "SelfExecuted";
export interface TinRec {
  index: number; address: Address; roundId: string; reqIdx: number; size: string; reserved: string;
  state: TinState; receipt?: unknown; createdAt: string;
  /** From the public tin-set snapshot (M8): current USDG and card token IDs. */
  usdg?: string; cards?: string[];
  /** A gift tin (Build §6): shared by link; `takenBack` once the giver reclaimed it. */
  gift?: { note: string; takenBack?: boolean };
  /** Card token IDs this tin has posted to a Rip Room. */
  posted?: string[];
  /** Used for a rip (Build §5A.2): never offered to a pack site again. */
  ripped?: boolean;
}

/** The indexer's public tin set (services/indexer). */
export interface TinSnapshot { block: string; asOf: string; tins: { tin: Address; roundId: string; funded: string; usdg: string; cards: string[] }[] }
export interface EntryRec { seq: string; kind: "Deposit" | "SendBack"; origin: Address; gross: string; state: "Pending" | "Admitted" | "Flagged" | "Refunded"; standbyEnds?: string }

/** Persisted (inside the encrypted vault). Leaves and nullifiers are public and re-synced. */
export interface WalletState { lastBlock: string; notes: NoteRec[]; tins: TinRec[]; nextTin: number; entries: EntryRec[] }
/** Fresh wallet state that syncs from `startBlock`. */
export const emptyState = (startBlock: bigint): WalletState => ({ lastBlock: (startBlock - 1n).toString(), notes: [], tins: [], nextTin: 0, entries: [] });

type Log = ReturnType<typeof parseEventLogs<typeof stashPoolAbi>>[number];

/** One user's wallet over a single pool; state changes are reported via `onChange` for the vault to persist. */
export class Wallet {
  tree: MerkleTree;
  private leaves: bigint[] = [];
  private nullifiers = new Set<bigint>();
  private entryBlobs = new Map<string, { blob: Hex; gross: bigint; npk: bigint; origin: Address; kind: number }>();
  private token: bigint;

  constructor(
    private c: Crypto,
    readonly keys: Keys,
    readonly api: Api,
    private chain: PublicClient,
    readonly cfg: WalletConfig,
    private prover: Prover,
    public state: WalletState,
    private onChange: (s: WalletState) => void = () => {},
  ) {
    this.tree = new MerkleTree(c);
    this.token = BigInt(cfg.usdg);
  }

  // ------------------------------------------------------------------ reading

  /** Spendable Stash balance: sum of unspent notes (USDG base units). */
  get balance(): bigint {
    return this.state.notes.filter((n) => !n.spent).reduce((s, n) => s + BigInt(n.amount), 0n);
  }
  /** Gross value of our entries still in standby (USDG base units). */
  get pending(): bigint {
    return this.state.entries.filter((e) => e.state === "Pending").reduce((s, e) => s + BigInt(e.gross), 0n);
  }

  /** Re-reads every pool event from the start block (leaves are public; nothing per-user is queried). */
  async sync(chunk = 50_000n): Promise<void> {
    this.leaves = [];
    this.nullifiers.clear();
    this.entryBlobs.clear();
    const latest = await this.chain.getBlockNumber();
    const logs: Log[] = [];
    for (let from = this.cfg.startBlock; from <= latest; from += chunk) {
      const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
      const raw = await this.chain.getLogs({ address: this.cfg.pool, fromBlock: from, toBlock: to });
      logs.push(...parseEventLogs({ abi: stashPoolAbi, logs: raw }));
    }
    const known = new Map(this.state.notes.map((n) => [n.leaf, n]));
    const notes: NoteRec[] = [];
    for (const l of logs) this.apply(l, known, notes);
    for (const n of notes) n.spent = this.nullifiers.has(nullifierOf(this.c, this.keys.owner.nk, BigInt(n.rho), this.cfg.poolId));
    const tree = new MerkleTree(this.c);
    for (const leaf of this.leaves) tree.insert(leaf);
    this.tree = tree;
    this.state = { ...this.state, notes, lastBlock: latest.toString() };
    this.onChange(this.state);
  }

  private apply(l: Log, _known: Map<number, NoteRec>, notes: NoteRec[]) {
    const a = l.args as Record<string, unknown>;
    switch (l.eventName) {
      case "EntryCreated": {
        const seq = String(a.seq);
        this.entryBlobs.set(seq, {
          blob: joinBlob(a.ciphertext as Hex, a.epk as Hex), gross: a.gross as bigint, npk: a.npk as bigint,
          origin: a.origin as Address, kind: Number(a.kind),
        });
        const mine = this.ownEntry(seq);
        if (mine) this.upsertEntry({ seq, kind: Number(a.kind) === 0 ? "Deposit" : "SendBack", origin: a.origin as Address, gross: String(a.gross), state: "Pending" });
        break;
      }
      case "EntryAdmitted": {
        const seq = String(a.seq);
        this.leaves[Number(a.leafIndex)] = a.commitment as bigint;
        const own = this.ownEntry(seq);
        if (own) {
          this.setEntryState(seq, "Admitted");
          if (commitmentOf(this.c, this.token, own.amount, npkOf(this.c, this.keys.owner.mpk, own.rho)) === a.commitment) {
            notes.push({ leaf: Number(a.leafIndex), amount: own.amount.toString(), rho: own.rho.toString(), spent: false });
          }
        }
        break;
      }
      case "EntryFlagged": this.setEntryState(String(a.seq), "Flagged"); break;
      case "EntryRefunded": this.setEntryState(String(a.seq), "Refunded"); break;
      case "NewCommitment": {
        const leaf = Number(a.leafIndex);
        const commitment = a.commitment as bigint;
        this.leaves[leaf] = commitment;
        const blob = a.encryptedOutput as Hex;
        const n = blob.length > 2 ? decryptNote(this.keys.ekPriv, blob) : this.refundFor(commitment);
        if (n && n.amount > 0n && commitmentOf(this.c, this.token, n.amount, npkOf(this.c, this.keys.owner.mpk, n.rho)) === commitment) {
          notes.push({ leaf, amount: n.amount.toString(), rho: n.rho.toString(), spent: false });
        }
        break;
      }
      case "NewNullifier": this.nullifiers.add(a.nullifier as bigint); break;
      case "TinFunded": this.setTin((t) => t.address.toLowerCase() === String(a.tin).toLowerCase() && t.roundId === String(a.roundId),
        Number(a.how) === 3 ? "SelfExecuted" : "Funded"); break;
      case "RequestCancelled": this.setTin((t) => t.roundId === String(a.roundId) && t.reqIdx === Number(a.reqIdx), "Cancelled"); break;
    }
  }

  /** Our entry if its ciphertext decrypts to us: amount is the admitted (net) amount. */
  private ownEntry(seq: string) {
    const e = this.entryBlobs.get(seq);
    if (!e) return null;
    const n = decryptNote(this.keys.ekPriv, e.blob);
    if (!n || npkOf(this.c, this.keys.owner.mpk, n.rho) !== e.npk) return null;
    return n;
  }

  /** Cancelled requests refund to a seed-derived rho, with no ciphertext. */
  private refundFor(commitment: bigint) {
    for (const t of this.state.tins) {
      const rho = this.keys.refundRho(t.index);
      if (commitmentOf(this.c, this.token, BigInt(t.reserved), npkOf(this.c, this.keys.owner.mpk, rho)) === commitment) {
        return { amount: BigInt(t.reserved), rho };
      }
    }
    return null;
  }

  private upsertEntry(e: EntryRec) {
    this.state = { ...this.state, entries: [e, ...this.state.entries.filter((x) => x.seq !== e.seq)] };
  }
  private setEntryState(seq: string, s: EntryRec["state"]) {
    this.state = { ...this.state, entries: this.state.entries.map((e) => (e.seq === seq ? { ...e, state: s } : e)) };
  }
  private setTin(match: (t: TinRec) => boolean, s: TinState) {
    this.state = { ...this.state, tins: this.state.tins.map((t) => (match(t) ? { ...t, state: s } : t)) };
  }

  /**
   * Match our tins against the public snapshot (Build §2 discovery): refresh balances and
   * cards, and after a restore find tins we have no record of by deriving our own tin
   * addresses locally (gap limit). Nothing about our tins is sent anywhere.
   */
  discover(snap: TinSnapshot, gap = 20): number {
    const byAddr = new Map(snap.tins.map((t) => [t.tin.toLowerCase(), t]));
    const tins = this.state.tins.map((t) => {
      const s = byAddr.get(t.address.toLowerCase());
      return s ? { ...t, usdg: s.usdg, cards: s.cards, state: t.state === "Requested" ? ("Funded" as const) : t.state } : t;
    });
    const known = new Set(tins.map((t) => t.index));
    let next = this.state.nextTin;
    let found = 0;
    for (let i = 0, misses = 0; i < next || misses < gap; i++) {
      if (known.has(i)) continue;
      const { address } = this.keys.tin(i);
      const s = byAddr.get(address.toLowerCase());
      if (!s) {
        if (i >= next) misses++;
        continue;
      }
      tins.push({
        index: i, address, roundId: s.roundId, reqIdx: -1, size: s.funded, reserved: "0", state: "Funded",
        createdAt: snap.asOf, usdg: s.usdg, cards: s.cards,
      });
      next = Math.max(next, i + 1);
      misses = 0;
      found++;
    }
    tins.sort((a, b) => b.index - a.index);
    this.state = { ...this.state, tins, nextTin: next };
    this.onChange(this.state);
    return found;
  }

  // ------------------------------------------------------------------ helpers

  private read<T>(functionName: string, args: unknown[] = []) {
    return this.chain.readContract({ address: this.cfg.pool, abi: stashPoolAbi, functionName, args } as never) as Promise<T>;
  }

  /** Chain time, not the device clock: the contract decides by block.timestamp. */
  private async chainNow(): Promise<bigint> {
    return (await this.chain.getBlock()).timestamp;
  }

  private async relay(fn: string, args: unknown[]): Promise<Hex> {
    const r = (await this.api.relay.mutate({ fn, args: toJson(args) as unknown[] })) as { txHash: Hex };
    return r.txHash;
  }

  /** Up to two unspent notes covering `target` (largest first). */
  private select(target: bigint): [OwnedNote, OwnedNote] {
    const unspent = this.state.notes.filter((n) => !n.spent).sort((x, y) => (BigInt(y.amount) > BigInt(x.amount) ? 1 : -1));
    const pick = unspent.slice(0, 2);
    const total = pick.reduce((s, n) => s + BigInt(n.amount), 0n);
    if (total < target) {
      throw new Error(unspent.length > 2 ? "Combine notes first: a spend uses at most two." : "Not enough in your Stash.");
    }
    const owned = pick.map((n) => ({ amount: BigInt(n.amount), rho: BigInt(n.rho), index: n.leaf }));
    const notes: OwnedNote[] = owned;
    while (notes.length < 2) notes.push({ amount: 0n, rho: randomField() }); // zero dummy, no membership
    return notes as [OwnedNote, OwnedNote];
  }

  private proof(name: "joinsplit" | "tin_request", input: Record<string, unknown>): Promise<SolidityProof> {
    return this.prover(name, input);
  }

  // ------------------------------------------------------------------ actions

  /** Arguments for StashPool.deposit, sent from the user's outside wallet (public anyway). */
  depositArgs(amount: bigint) {
    const rho = randomField();
    const fee = (amount * 15n + 9_999n) / 10_000n;
    const { ciphertext, epk } = splitBlob(encryptNote(this.keys.ekPub, amount - fee, rho));
    return { amount, npk: npkOf(this.c, this.keys.owner.mpk, rho), ciphertext, epk };
  }

  /**
   * Admit at most one of our pending entries per call, picked at random, after a random
   * wait: at once with ≥ 2 ppoi-node signatures (clean deposit or clean-inbound
   * send-back), otherwise once standby has ended. The relayer pays gas. One per call
   * keeps our admissions from landing as a burst of consecutive relayer transactions,
   * which would link a deposit origin to our tins. Returns 1 if it admitted one.
   */
  async admitReady(): Promise<number> {
    const pending = this.state.entries.filter((x) => x.state === "Pending");
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j]!, pending[i]!];
    }
    const now = await this.chainNow();
    for (const e of pending) {
      const seq = BigInt(e.seq);
      const sigs = await this.api.attest.mutate({ seq: e.seq }).catch(() => [] as string[]);
      const entry = sigs.length >= 2 ? null : await this.read<readonly unknown[]>("entries", [seq]);
      if (entry && BigInt(entry[3] as bigint) + BigInt(this.cfg.selfAdmitAfterSec ?? 600) > now) continue;
      const jitter = this.cfg.admitJitterMs ?? 5_000;
      if (jitter > 0) await new Promise((r) => setTimeout(r, Math.random() * jitter));
      await (entry ? this.relay("admitAfterStandby", [seq]) : this.relay("admitWithSignatures", [seq, sigs]));
      return 1;
    }
    return 0;
  }

  /** Withdraw to an outside wallet (0.25% protocol fee + relayer fee). */
  async withdraw(amount: bigint, recipient: Address): Promise<Hex> {
    return this.joinsplit(-amount, recipient, null);
  }

  /** Private transfer to another Foil stash address. */
  async send(amount: bigint, to: { mpk: bigint; ekPub: Uint8Array }): Promise<Hex> {
    return this.joinsplit(0n, "0x0000000000000000000000000000000000000000", { amount, ...to });
  }

  private async joinsplit(extAmount: bigint, recipient: Address, to: { amount: bigint; mpk: bigint; ekPub: Uint8Array } | null) {
    const fee = this.cfg.relayerFee;
    const out = -extAmount + (to?.amount ?? 0n);
    const inputs = this.select(out + fee);
    const change = inputs[0].amount + inputs[1].amount - out - fee;
    const changeRho = randomField();
    const otherRho = randomField();
    const other = to
      ? { amount: to.amount, npk: npkOf(this.c, to.mpk, otherRho), blob: encryptNote(to.ekPub, to.amount, otherRho) }
      : { amount: 0n, npk: npkOf(this.c, this.keys.owner.mpk, otherRho), blob: encryptNote(this.keys.ekPub, 0n, otherRho) };
    const { input, call } = buildJoinsplit({
      c: this.c, owner: this.keys.owner, tree: this.tree, token: this.token, poolId: this.cfg.poolId, inputs,
      outputs: [{ amount: change, npk: npkOf(this.c, this.keys.owner.mpk, changeRho) }, { amount: other.amount, npk: other.npk }],
      ext: {
        recipient, extAmount, relayer: this.cfg.relayer, fee,
        encryptedOutput1: encryptNote(this.keys.ekPub, change, changeRho), encryptedOutput2: other.blob,
      },
    });
    const p = await this.proof("joinsplit", input);
    return this.relay("transact", [p, call.root, call.nullifiers, call.outs, call.ext]);
  }

  /** Request a tin of `size` in the current round, then reveal (tin, salt) to the operator. */
  async requestTin(size: TinSize): Promise<TinRec> {
    const sizeMicros = BigInt(size) * 1_000_000n;
    const i = this.state.nextTin;
    const tin = this.keys.tin(i);
    const [reserved, roundId] = await Promise.all([this.read<bigint>("reservedFor", [sizeMicros]), this.read<bigint>("currentRound")]);
    const inputs = this.select(reserved + this.cfg.relayerFee);
    const changeRho = randomField();
    const changeAmount = inputs[0].amount + inputs[1].amount - reserved - this.cfg.relayerFee;
    const encryptedChange = encryptNote(this.keys.ekPub, changeAmount, changeRho);
    const { input, call } = buildTinRequest({
      c: this.c, owner: this.keys.owner, tree: this.tree, token: this.token, poolId: this.cfg.poolId, inputs,
      size: sizeMicros, reserved, fee: this.cfg.relayerFee, roundId, tin: tin.address, salt: this.keys.tinSalt(i),
      cancelSecret: this.keys.cancelSecret(i), relayer: this.cfg.relayer, encryptedChange, changeRho, refundRho: this.keys.refundRho(i),
    });
    const p = await this.proof("tin_request", input);
    const txHash = await this.relay("requestTin", [p, call]);
    const ref = decodeRequestRef(await this.read<bigint>("requestOfCommit", [call.tinCommit]));
    if (!ref) throw new Error("request not found after inclusion");
    const rec: TinRec = {
      index: i, address: tin.address, roundId: roundId.toString(), reqIdx: ref.reqIdx, size: sizeMicros.toString(),
      reserved: reserved.toString(), state: "Requested", createdAt: new Date().toISOString(),
    };
    this.state = { ...this.state, nextTin: i + 1, tins: [rec, ...this.state.tins] };
    this.onChange(this.state);
    const receipt = await this.api.reveal.mutate({ roundId: roundId.toString(), tin: tin.address, salt: this.keys.tinSalt(i) });
    await this.checkReceipt(receipt, roundId, call.tinCommit);
    rec.receipt = receipt;
    this.onChange(this.state);
    void txHash;
    return rec;
  }

  /**
   * An operator receipt is only evidence for an omission slash if it is signed by a pool
   * operator, names our request, and was received before the round closed. Check it now,
   * while the request can still be cancelled, instead of when it is needed.
   */
  private async checkReceipt(r: unknown, roundId: bigint, tinCommit: bigint) {
    const x = r as { roundId: string; tinCommit: string; receivedAt: string; signature: Hex };
    const message = { roundId: BigInt(x.roundId), tinCommit: BigInt(x.tinCommit), receivedAt: BigInt(x.receivedAt) };
    const signer = await recoverTypedDataAddress({
      domain: { name: "FoilRoundOperator", version: "1", chainId: this.cfg.chainId, verifyingContract: this.cfg.pool },
      types: { RevealReceipt: [{ name: "roundId", type: "uint256" }, { name: "tinCommit", type: "uint256" }, { name: "receivedAt", type: "uint64" }] },
      primaryType: "RevealReceipt", message, signature: x.signature,
    });
    const skew = BigInt(this.cfg.receiptSkewSec ?? 15);
    if (message.roundId !== roundId || message.tinCommit !== tinCommit || message.receivedAt > (await this.chainNow()) + skew
      || !(await this.read<boolean>("operators", [signer]))) throw new Error("operator receipt failed verification");
  }

  /** Cancel a pending tin request with its seed-derived cancel secret; the reserve returns as our refund note. */
  async cancelTin(t: TinRec): Promise<Hex> {
    return this.relay("cancelRequest", [BigInt(t.roundId), BigInt(t.reqIdx), this.keys.cancelSecret(t.index)]);
  }

  /** Fund a still-pending tin ourselves by revealing (tin, salt); allowed 60 min after its round closed. */
  async selfExecuteTin(t: TinRec): Promise<Hex> {
    return this.relay("selfExecute", [BigInt(t.roundId), BigInt(t.reqIdx), t.address, this.keys.tinSalt(t.index)]);
  }

  /** Return USDG from one of our tins to the Stash (Build §3.3): the tin signs, the relayer submits. */
  sendBack(t: TinRec, amount: bigint): Promise<Hex> {
    return this.sendBackFrom(this.keys.tin(t.index).privateKey, amount);
  }

  /** Claim a gift (Build §6): move a gift tin's USDG into OUR Stash with its key from the link. */
  claimGift(tinKey: Hex, amount: bigint): Promise<Hex> {
    return this.sendBackFrom(tinKey, amount);
  }

  /** Mark one of our tins as a gift (kept in the encrypted backup with the tin record). */
  markGift(index: number, note: string) {
    this.state = { ...this.state, tins: this.state.tins.map((t) => (t.index === index ? { ...t, gift: { note } } : t)) };
    this.onChange(this.state);
  }

  /** Mark a tin as used for a rip so it is never offered to a pack site again. */
  markRipped(index: number) {
    this.state = { ...this.state, tins: this.state.tins.map((t) => (t.index === index ? { ...t, ripped: true } : t)) };
    this.onChange(this.state);
  }

  /** Record that the giver reclaimed this gift tin (no-op for a non-gift tin). */
  markGiftTakenBack(index: number) {
    this.state = { ...this.state, tins: this.state.tins.map((t) => (t.index === index && t.gift ? { ...t, gift: { ...t.gift, takenBack: true } } : t)) };
    this.onChange(this.state);
  }

  /** Any tin key → note in our Stash. The note is encrypted to our ek, so we find it on sync. */
  private async sendBackFrom(tinKey: Hex, amount: bigint): Promise<Hex> {
    const account = privateKeyToAccount(tinKey);
    const rho = randomField();
    const npk = npkOf(this.c, this.keys.owner.mpk, rho);
    // The note must hold exactly what the contract will commit: gross minus its fee.
    const [funded, sent] = await Promise.all([this.read<bigint>("tinFunded", [account.address]), this.read<bigint>("tinSentBack", [account.address])]);
    const freeLeft = funded > sent ? funded - sent : 0n;
    const fee = amount > freeLeft ? ((amount - freeLeft) * 25n + 9_999n) / 10_000n : 0n;
    const { ciphertext, epk } = splitBlob(encryptNote(this.keys.ekPub, amount - fee, rho));
    // The nonce binds the fee too: if another send-back lands first and changes it, the
    // pool rejects this one instead of committing a note that differs from its ciphertext.
    const nonce = keccak256(encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
      [npk, fee, keccak256(ciphertext), keccak256(epk), this.cfg.poolId, BigInt(this.cfg.chainId)],
    ));
    const validBefore = (await this.chainNow()) + 3600n;
    const sig = await account.signTypedData({
      domain: { name: USDG.eip712.name, version: USDG.eip712.version, chainId: this.cfg.chainId, verifyingContract: this.cfg.usdg },
      types: { ReceiveWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ] },
      primaryType: "ReceiveWithAuthorization",
      message: { from: account.address, to: this.cfg.pool, value: amount, validAfter: 0n, validBefore, nonce },
    });
    const r = `0x${sig.slice(2, 66)}` as Hex;
    const s = `0x${sig.slice(66, 130)}` as Hex;
    const v = parseInt(sig.slice(130, 132), 16);
    return this.relay("returnToStash", [{ from: account.address, value: amount, validAfter: 0n, validBefore, v, r, s }, fee, npk, ciphertext, epk]);
  }

  /** Refund a pending/flagged entry whose origin is one of our tins (no ETH needed). */
  async exitPendingFromTin(seq: bigint, t: TinRec): Promise<Hex> {
    const account = privateKeyToAccount(this.keys.tin(t.index).privateKey);
    const deadline = (await this.chainNow()) + 3600n;
    const digest = await this.read<Hex>("exitDigest", [seq, deadline]);
    const sig = await account.sign({ hash: digest });
    return this.relay("exitPending", [seq, deadline, sig]);
  }

  /**
   * Post a hit to this season's Rip Room (Build §7). Links this tin to the season handle;
   * a second post links those tins to each other (the UI warns before that).
   */
  async postHit(t: TinRec, tokenId: bigint) {
    const post = await this.api.rooms.post.mutate(await signPost(this.keys, this.keys.tin(t.index).privateKey, tokenId));
    this.state = { ...this.state, tins: this.state.tins.map((x) => (x.index === t.index ? { ...x, posted: [...(x.posted ?? []), post.tokenId] } : x)) };
    this.onChange(this.state);
    return post;
  }

  /** Explicit key export (Build §2): the tin's EVM private key. */
  exportTinKey(t: TinRec): Hex {
    return this.keys.tin(t.index).privateKey;
  }

  /** For the UI: a stable random-looking id without exposing addresses in lists. */
  static tinId(t: TinRec) {
    return `tin-${bytesToHex(new TextEncoder().encode(String(t.index))).slice(2)}`;
  }
}
