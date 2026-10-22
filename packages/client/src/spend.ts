/**
 * Builds joinsplit / tin_request witnesses and the matching on-chain arguments.
 * Mirrors contracts/src/StashPool.sol (extDataHash, publicAmount) exactly.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { cancelHashOf, tinCommitOf, tinRequestDataHash } from "@foil/protocol";
import {
  FIELD, commitmentOf, mpkOf, npkOf, nullifierOf, randomField, type Crypto, type MerkleTree,
} from "./crypto";

export interface Owner { sk: Uint8Array; Ax: bigint; Ay: bigint; nk: bigint; mpk: bigint }
/** Spending identity from sk_auth and nk: EdDSA public key plus mpk. */
export function ownerFrom(c: Crypto, sk: Uint8Array, nk: bigint): Owner {
  const { Ax, Ay } = c.pubKey(sk);
  return { sk, Ax, Ay, nk, mpk: mpkOf(c, Ax, Ay, nk) };
}

/** A note the owner can spend. index is its leaf position (undefined for a zero dummy). */
export interface OwnedNote { amount: bigint; rho: bigint; index?: number }

export interface ExtData {
  recipient: Address;
  extAmount: bigint; // ≤ 0
  relayer: Address;
  fee: bigint;
  encryptedOutput1: Hex;
  encryptedOutput2: Hex;
}

const EXT_TUPLE = {
  type: "tuple",
  components: [
    { name: "recipient", type: "address" },
    { name: "extAmount", type: "int256" },
    { name: "relayer", type: "address" },
    { name: "fee", type: "uint256" },
    { name: "encryptedOutput1", type: "bytes" },
    { name: "encryptedOutput2", type: "bytes" },
  ],
} as const;

/** keccak256(abi.encode(poolId, ext)) mod FIELD; binds the proof to its external data (StashPool). */
export function extDataHash(poolId: bigint, ext: ExtData): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, EXT_TUPLE], [poolId, ext]))) % FIELD;
}

/** Circuit publicAmount: (extAmount − fee) as a field element (negative wraps mod FIELD), as StashPool computes it. */
export const publicAmountOf = (extAmount: bigint, fee: bigint) => {
  const out = -extAmount + fee;
  return out === 0n ? 0n : FIELD - out;
};

function spendPart(c: Crypto, o: Owner, tree: MerkleTree, notes: [OwnedNote, OwnedNote], poolId: bigint) {
  const paths = notes.map((n) =>
    n.index === undefined ? { pathElements: Array<bigint>(tree.levels).fill(0n), pathIndices: 0n } : tree.path(n.index),
  );
  return {
    inNullifier: notes.map((n) => nullifierOf(c, o.nk, n.rho, poolId)) as [bigint, bigint],
    inAmount: notes.map((n) => n.amount),
    inRho: notes.map((n) => n.rho),
    inPathElements: paths.map((p) => p.pathElements),
    inPathIndices: paths.map((p) => p.pathIndices),
  };
}

/** Zero-amount input with a random rho, to fill an unused joinsplit slot. */
export const dummyNote = (): OwnedNote => ({ amount: 0n, rho: randomField() });

export interface JoinsplitArgs {
  c: Crypto;
  owner: Owner;
  tree: MerkleTree;
  token: bigint;
  poolId: bigint;
  inputs: [OwnedNote, OwnedNote];
  outputs: [{ amount: bigint; npk: bigint }, { amount: bigint; npk: bigint }];
  ext: ExtData;
}

/**
 * Signed joinsplit witness (`input`) and the matching `transact` args (`call`). Throws unless
 * inputs + extAmount − fee = outputs (all USDG base units).
 */
export function buildJoinsplit(a: JoinsplitArgs) {
  const { c, owner, tree, token, poolId } = a;
  const spend = spendPart(c, owner, tree, a.inputs, poolId);
  const outCommitment = a.outputs.map((o) => commitmentOf(c, token, o.amount, o.npk)) as [bigint, bigint];
  const sumIn = a.inputs[0].amount + a.inputs[1].amount;
  const sumOut = a.outputs[0].amount + a.outputs[1].amount;
  if (sumIn + a.ext.extAmount - a.ext.fee !== sumOut) throw new Error("joinsplit does not balance");
  const root = tree.root;
  const publicAmount = publicAmountOf(a.ext.extAmount, a.ext.fee);
  const edh = extDataHash(poolId, a.ext);
  const msg = c.hash(root, publicAmount, edh, spend.inNullifier[0], spend.inNullifier[1], outCommitment[0], outCommitment[1]);
  const sig = c.sign(owner.sk, msg);
  return {
    input: {
      root, publicAmount, extDataHash: edh, token, poolId, ...spend,
      outCommitment, outAmount: a.outputs.map((o) => o.amount), outNpk: a.outputs.map((o) => o.npk),
      Ax: owner.Ax, Ay: owner.Ay, nk: owner.nk, sigS: sig.S, sigR8x: sig.R8x, sigR8y: sig.R8y,
    },
    call: { root, nullifiers: spend.inNullifier, outs: outCommitment, ext: a.ext },
  };
}

/** npk for a note paid to this owner with the given rho. */
export const ownNpk = (c: Crypto, o: Owner, rho: bigint) => npkOf(c, o.mpk, rho);

export interface TinRequestArgs {
  c: Crypto;
  owner: Owner;
  tree: MerkleTree;
  token: bigint;
  poolId: bigint;
  inputs: [OwnedNote, OwnedNote];
  size: bigint;
  reserved: bigint; // StashPool.reservedFor(size), read from chain
  fee: bigint; // relayer fee
  roundId: bigint;
  tin: Address;
  salt: Hex;
  cancelSecret: Hex;
  relayer: Address;
  encryptedChange: Hex;
  changeRho: bigint;
  refundRho: bigint;
}

/**
 * Signed tin_request witness and `requestTin` args: spends two notes for `reserved` + `fee`,
 * returns change as a new note, and commits to the tin, refund note and cancel hash.
 * Throws if the inputs do not cover reserved + fee (USDG base units).
 */
export function buildTinRequest(a: TinRequestArgs) {
  const { c, owner, tree, token, poolId } = a;
  const spend = spendPart(c, owner, tree, a.inputs, poolId);
  const changeAmount = a.inputs[0].amount + a.inputs[1].amount - a.reserved - a.fee;
  if (changeAmount < 0n) throw new Error("notes do not cover the tin");
  const changeCommitment = commitmentOf(c, token, changeAmount, npkOf(c, owner.mpk, a.changeRho));
  const refundCommit = commitmentOf(c, token, a.reserved, npkOf(c, owner.mpk, a.refundRho));
  const tinCommit = tinCommitOf(a.tin, a.salt, a.size, a.roundId);
  const cancelHash = cancelHashOf(a.cancelSecret);
  const edh = tinRequestDataHash(poolId, a.relayer, a.encryptedChange);
  const root = tree.root;
  const msg = c.hash(root, edh, spend.inNullifier[0], spend.inNullifier[1], changeCommitment, a.reserved, a.fee, a.roundId, tinCommit, refundCommit, cancelHash);
  const sig = c.sign(owner.sk, msg);
  return {
    input: {
      root, extDataHash: edh, token, poolId, ...spend, changeCommitment, reserved: a.reserved, fee: a.fee,
      roundId: a.roundId, tinCommit, refundCommit, cancelHash,
      Ax: owner.Ax, Ay: owner.Ay, nk: owner.nk, sigS: sig.S, sigR8x: sig.R8x, sigR8y: sig.R8y,
      changeAmount, changeRho: a.changeRho, refundRho: a.refundRho,
    },
    call: {
      root, nullifiers: spend.inNullifier, changeCommitment, size: a.size, fee: a.fee, roundId: a.roundId,
      tinCommit, refundCommit, cancelHash, relayer: a.relayer, encryptedChange: a.encryptedChange,
    },
  };
}
