import { setDefaultTimeout } from "bun:test";
import * as snarkjs from "snarkjs";
import {
  FIELD, MerkleTree, commitmentOf, loadCrypto, mpkOf, npkOf, nullifierOf, randomField, type Crypto,
} from "@foil/client";
import { compile } from "../scripts/build";

// Witness generation at depth 32 takes several seconds per test on a laptop.
setDefaultTimeout(60_000);

export const TOKEN = BigInt("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
export const POOL_ID = 1n;

const wasmCache = new Map<string, string>();
export function wasmFor(name: "joinsplit" | "tin_request" | "ppoi") {
  if (!wasmCache.has(name)) wasmCache.set(name, compile(name).wasm);
  return wasmCache.get(name)!;
}

type Input = Record<string, bigint | bigint[] | bigint[][]>;
const str = (v: unknown): unknown => (Array.isArray(v) ? v.map(str) : typeof v === "bigint" ? v.toString() : v);

/** Resolves if every constraint holds; rejects otherwise (circom asserts on ===). */
export async function witness(name: Parameters<typeof wasmFor>[0], input: Input) {
  const json = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, str(v)]));
  await snarkjs.wtns.calculate(json, wasmFor(name), { type: "mem" });
}

export interface Owner { sk: Uint8Array; Ax: bigint; Ay: bigint; nk: bigint; mpk: bigint }
export function newOwner(c: Crypto): Owner {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  const { Ax, Ay } = c.pubKey(sk);
  const nk = randomField();
  return { sk, Ax, Ay, nk, mpk: mpkOf(c, Ax, Ay, nk) };
}

export interface Note { amount: bigint; rho: bigint; commitment: bigint; index?: number }
export function note(c: Crypto, o: Owner, amount: bigint, tree?: MerkleTree): Note {
  const rho = randomField();
  const commitment = commitmentOf(c, TOKEN, amount, npkOf(c, o.mpk, rho));
  return { amount, rho, commitment, index: tree?.insert(commitment) };
}

export function spendInputs(c: Crypto, o: Owner, tree: MerkleTree, notes: [Note, Note]) {
  const paths = notes.map((n) => (n.index === undefined ? { pathElements: Array(tree.levels).fill(0n), pathIndices: 0n } : tree.path(n.index)));
  return {
    inNullifier: notes.map((n) => nullifierOf(c, o.nk, n.rho, POOL_ID)),
    inAmount: notes.map((n) => n.amount),
    inRho: notes.map((n) => n.rho),
    inPathElements: paths.map((p) => p.pathElements),
    inPathIndices: paths.map((p) => p.pathIndices),
  };
}

export const neg = (x: bigint) => (FIELD - x) % FIELD;
export { loadCrypto, MerkleTree, npkOf, commitmentOf, randomField, FIELD };
