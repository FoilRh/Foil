import { beforeAll, describe, expect, test } from "bun:test";
import {
  MerkleTree, POOL_ID, TOKEN, commitmentOf, loadCrypto, neg, newOwner, note, npkOf, randomField, spendInputs, witness, type Owner,
} from "./helpers";
import type { Crypto } from "@foil/client";

let c: Crypto;
let owner: Owner;

beforeAll(async () => {
  c = await loadCrypto();
  owner = newOwner(c);
});

/** Withdraw 10 USDG + 0.25 fee from a 30 USDG note; 19.75 change back to self. */
function valid(overrides: Record<string, unknown> = {}, signer?: Owner) {
  const tree = new MerkleTree(c);
  tree.insert(randomField()); // someone else's note
  const n0 = note(c, owner, 30_000_000n, tree);
  const n1 = note(c, owner, 0n); // dummy
  const spend = spendInputs(c, owner, tree, [n0, n1]);
  const outNpk = [npkOf(c, owner.mpk, randomField()), randomField()];
  const outAmount = [19_750_000n, 0n];
  const outCommitment = outAmount.map((a, i) => commitmentOf(c, TOKEN, a, outNpk[i]!));
  const publicAmount = neg(10_250_000n);
  const extDataHash = randomField();
  const base = { root: tree.root, publicAmount, extDataHash, token: TOKEN, poolId: POOL_ID, ...spend, outAmount, outNpk, outCommitment };
  const input = { ...base, ...overrides } as typeof base;
  const msg = c.hash(input.root, input.publicAmount, input.extDataHash, input.inNullifier[0]!, input.inNullifier[1]!, input.outCommitment[0]!, input.outCommitment[1]!);
  const sig = c.sign((signer ?? owner).sk, msg);
  return { ...input, Ax: owner.Ax, Ay: owner.Ay, nk: owner.nk, sigS: sig.S, sigR8x: sig.R8x, sigR8y: sig.R8y };
}

describe("joinsplit", () => {
  test("valid withdraw with change", async () => {
    await witness("joinsplit", valid());
  });

  test("rejects a proof signed by anyone but sk_auth (key split)", async () => {
    await expect(witness("joinsplit", valid({}, newOwner(c)))).rejects.toThrow();
  });

  test("rejects broken conservation", async () => {
    const v = valid();
    const outAmount = [v.outAmount[0]! + 1n, 0n];
    const outCommitment = outAmount.map((a, i) => commitmentOf(c, TOKEN, a, v.outNpk[i]!));
    await expect(witness("joinsplit", valid({ outAmount, outCommitment, outNpk: v.outNpk }))).rejects.toThrow();
  });

  test("rejects a wrong root for a non-zero input", async () => {
    await expect(witness("joinsplit", valid({ root: randomField() }))).rejects.toThrow();
  });

  test("rejects a wrong nullifier", async () => {
    const v = valid();
    await expect(witness("joinsplit", valid({ inNullifier: [randomField(), v.inNullifier[1]] }))).rejects.toThrow();
  });

  test("rejects a note owned by someone else", async () => {
    const other = newOwner(c);
    const tree = new MerkleTree(c);
    const theirs = note(c, other, 30_000_000n, tree);
    const spend = spendInputs(c, owner, tree, [theirs, note(c, owner, 0n)]);
    // Re-signed by the spender, so only the ownership (mpk) check can fail.
    await expect(witness("joinsplit", valid({ ...spend, root: tree.root }))).rejects.toThrow();
  });

  test("rejects duplicate nullifiers", async () => {
    const tree = new MerkleTree(c);
    const n = note(c, owner, 0n);
    const outAmount = [0n, 0n];
    const v = valid();
    const outCommitment = outAmount.map((a, i) => commitmentOf(c, TOKEN, a, v.outNpk[i]!));
    const spend = spendInputs(c, owner, tree, [n, n]);
    await expect(witness("joinsplit", valid({ ...spend, root: tree.root, publicAmount: 0n, outAmount, outCommitment, outNpk: v.outNpk }))).rejects.toThrow();
  });

  test("zero-amount dummies need no membership", async () => {
    const tree = new MerkleTree(c);
    const outAmount = [0n, 0n];
    const v = valid();
    const outCommitment = outAmount.map((a, i) => commitmentOf(c, TOKEN, a, v.outNpk[i]!));
    const spend = spendInputs(c, owner, tree, [note(c, owner, 0n), note(c, owner, 0n)]);
    await witness("joinsplit", valid({ ...spend, root: randomField(), publicAmount: 0n, outAmount, outCommitment, outNpk: v.outNpk }));
  });

  test("rejects a field-wrapped (negative) output amount", async () => {
    const v = valid();
    const outAmount = [neg(1n), v.outAmount[0]! + 1n];
    const outCommitment = outAmount.map((a, i) => commitmentOf(c, TOKEN, a, v.outNpk[i]!));
    await expect(witness("joinsplit", valid({ outAmount, outCommitment, outNpk: v.outNpk }))).rejects.toThrow();
  });
});
