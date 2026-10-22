/// <reference path="./vendor.d.ts" />
/**
 * Note crypto matching circuits/src/lib.circom (Build §2, §3.1). Pure bigint API.
 *   mpk = Poseidon(Ax, Ay, Poseidon(nk))   npk = Poseidon(mpk, rho)
 *   C   = Poseidon(token, amount, npk)     N   = Poseidon(nk, rho, poolId)
 */
import { buildEddsa, buildPoseidon, type Eddsa, type Poseidon } from "circomlibjs";

import { FIELD } from "@foil/protocol";
export { FIELD };
export const TREE_LEVELS = 32;

export interface Crypto {
  hash(...inputs: bigint[]): bigint;
  pubKey(skAuth: Uint8Array): { Ax: bigint; Ay: bigint };
  sign(skAuth: Uint8Array, msg: bigint): { S: bigint; R8x: bigint; R8y: bigint };
}

let cached: Promise<Crypto> | undefined;

/** Builds Poseidon + Baby Jubjub EdDSA from circomlibjs once; later calls share the same promise. */
export function loadCrypto(): Promise<Crypto> {
  cached ??= (async () => {
    const [poseidon, eddsa]: [Poseidon, Eddsa] = await Promise.all([buildPoseidon(), buildEddsa()]);
    const F = poseidon.F;
    const E = eddsa.F;
    return {
      hash: (...inputs) => F.toObject(poseidon(inputs)),
      pubKey: (sk) => {
        const [x, y] = eddsa.prv2pub(sk);
        return { Ax: E.toObject(x), Ay: E.toObject(y) };
      },
      sign: (sk, msg) => {
        const sig = eddsa.signPoseidon(sk, E.e(msg));
        return { S: sig.S, R8x: E.toObject(sig.R8[0]), R8y: E.toObject(sig.R8[1]) };
      },
    };
  })();
  return cached;
}

/** Master public key: Poseidon(Ax, Ay, Poseidon(nk)). */
export const mpkOf = (c: Crypto, Ax: bigint, Ay: bigint, nk: bigint) => c.hash(Ax, Ay, c.hash(nk));
/** Per-note public key: Poseidon(mpk, rho). */
export const npkOf = (c: Crypto, mpk: bigint, rho: bigint) => c.hash(mpk, rho);
/** Note commitment (Merkle leaf): Poseidon(token, amount, npk); amount in USDG base units. */
export const commitmentOf = (c: Crypto, token: bigint, amount: bigint, npk: bigint) => c.hash(token, amount, npk);
/** Nullifier: Poseidon(nk, rho, poolId); published on spend, unlinkable to the commitment. */
export const nullifierOf = (c: Crypto, nk: bigint, rho: bigint, poolId: bigint) => c.hash(nk, rho, poolId);

/** Random field element (for rho, salts, blinds). */
export function randomField(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return BigInt(`0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`) % FIELD;
}

/** Field encoding of a 20-byte EVM address. */
export const addressToField = (addr: string) => BigInt(addr);

/**
 * Incremental Poseidon(2) Merkle tree with zero leaves = 0, matching
 * contracts/src/MerkleTree.sol.
 */
export class MerkleTree {
  readonly zeros: bigint[] = [0n];
  private layers: bigint[][] = [[]];
  constructor(private c: Crypto, readonly levels = TREE_LEVELS) {
    for (let i = 0; i < levels; i++) this.zeros.push(c.hash(this.zeros[i]!, this.zeros[i]!));
    for (let i = 1; i <= levels; i++) this.layers.push([]);
  }
  /** Current root (the all-zero root when empty). */
  get root(): bigint {
    return this.layers[this.levels]![0] ?? this.zeros[this.levels]!;
  }
  /** Number of leaves inserted. */
  get size() {
    return this.layers[0]!.length;
  }
  /** Appends a leaf and updates its path to the root; returns the leaf index. */
  insert(leaf: bigint): number {
    let idx = this.layers[0]!.length;
    const pos = idx;
    this.layers[0]!.push(leaf);
    for (let lvl = 0; lvl < this.levels; lvl++) {
      const left = this.layers[lvl]![idx & ~1] ?? this.zeros[lvl]!;
      const right = this.layers[lvl]![idx | 1] ?? this.zeros[lvl]!;
      idx >>= 1;
      this.layers[lvl + 1]![idx] = this.c.hash(left, right);
    }
    return pos;
  }
  /** Merkle proof for leaf `index` in circuit form (siblings bottom-up; `pathIndices` = index bits). */
  path(index: number): { pathElements: bigint[]; pathIndices: bigint } {
    if (index >= this.size) throw new Error("leaf not in tree");
    const pathElements: bigint[] = [];
    let idx = index;
    for (let lvl = 0; lvl < this.levels; lvl++) {
      pathElements.push(this.layers[lvl]![idx ^ 1] ?? this.zeros[lvl]!);
      idx >>= 1;
    }
    return { pathElements, pathIndices: BigInt(index) };
  }
}
