import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  MerkleTree, POOL_ID, TOKEN, commitmentOf, loadCrypto, newOwner, note, npkOf, randomField, spendInputs, witness, type Owner,
} from "./helpers";
import type { Crypto } from "@foil/client";

setDefaultTimeout(30_000); // the first witness of a run includes WASM warm-up

let c: Crypto;
let owner: Owner;
beforeAll(async () => {
  c = await loadCrypto();
  owner = newOwner(c);
});

/** $30 note → $25 tin + fee reserved, relayer fee 0.25, change back to self. */
function valid(overrides: Record<string, unknown> = {}, signer?: Owner) {
  const tree = new MerkleTree(c);
  const n0 = note(c, owner, 30_000_000n, tree);
  const spend = spendInputs(c, owner, tree, [n0, note(c, owner, 0n)]);
  const reserved = 25_000_000n + 37_500n + 200_000n + 1_000_000n;
  const fee = 250_000n;
  const changeAmount = 30_000_000n - reserved - fee;
  const changeRho = randomField();
  const refundRho = randomField();
  const base = {
    root: tree.root, extDataHash: randomField(), token: TOKEN, poolId: POOL_ID, ...spend,
    changeAmount, changeRho, refundRho, reserved, fee,
    changeCommitment: commitmentOf(c, TOKEN, changeAmount, npkOf(c, owner.mpk, changeRho)),
    refundCommit: commitmentOf(c, TOKEN, reserved, npkOf(c, owner.mpk, refundRho)),
    roundId: 7n, tinCommit: randomField(), cancelHash: randomField(),
  };
  const i = { ...base, ...overrides } as typeof base;
  const msg = c.hash(i.root, i.extDataHash, i.inNullifier[0]!, i.inNullifier[1]!, i.changeCommitment, i.reserved, i.fee, i.roundId, i.tinCommit, i.refundCommit, i.cancelHash);
  const sig = c.sign((signer ?? owner).sk, msg);
  return { ...i, Ax: owner.Ax, Ay: owner.Ay, nk: owner.nk, sigS: sig.S, sigR8x: sig.R8x, sigR8y: sig.R8y };
}

describe("tin_request", () => {
  test("valid request", async () => {
    await witness("tin_request", valid());
  });

  test("rejects a refund commitment owned by someone else", async () => {
    const v = valid();
    const thief = newOwner(c);
    const refundCommit = commitmentOf(c, TOKEN, v.reserved, npkOf(c, thief.mpk, v.refundRho));
    await expect(witness("tin_request", valid({ refundCommit }))).rejects.toThrow();
  });

  test("rejects a refund for a different amount than reserved", async () => {
    const v = valid();
    const refundCommit = commitmentOf(c, TOKEN, v.reserved + 1n, npkOf(c, owner.mpk, v.refundRho));
    await expect(witness("tin_request", valid({ refundCommit }))).rejects.toThrow();
  });

  test("rejects reserving more than the inputs hold", async () => {
    await expect(witness("tin_request", valid({ reserved: valid().reserved + 1n }))).rejects.toThrow();
  });

  test("tinCommit, roundId and cancelHash are bound by the signature", async () => {
    const v = valid();
    for (const swap of [{ tinCommit: randomField() }, { roundId: 8n }, { cancelHash: randomField() }]) {
      await expect(witness("tin_request", { ...v, ...swap })).rejects.toThrow();
    }
  });

  test("rejects a signature by another key", async () => {
    await expect(witness("tin_request", valid({}, newOwner(c)))).rejects.toThrow();
  });
});
