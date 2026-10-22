import { beforeAll, describe, expect, test } from "bun:test";
import { newMemEmptyTrie, type SMT } from "circomlibjs";
import { FIELD, loadCrypto, randomField, witness } from "./helpers";
import type { Crypto } from "@foil/client";

const LEVELS = 32;
let c: Crypto;
let smt: SMT;
const flagged = [0x1111n, 0x2222n, 0x3333n, 0xdeadn];

beforeAll(async () => {
  c = await loadCrypto();
  smt = await newMemEmptyTrie();
  for (const a of flagged) await smt.insert(smt.F.e(c.hash(a)), smt.F.e(1n));
});

async function inputFor(origin: bigint) {
  const F = smt.F;
  const res = await smt.find(F.e(c.hash(origin)));
  const siblings = res.siblings.map((s) => F.toObject(s));
  while (siblings.length < LEVELS) siblings.push(0n);
  const blind = randomField();
  return {
    providerRoot: F.toObject(smt.root),
    originHash: c.hash(origin, blind),
    origin, blind, siblings,
    oldKey: res.isOld0 ? 0n : F.toObject(res.notFoundKey),
    oldValue: res.isOld0 ? 0n : F.toObject(res.notFoundValue),
    isOld0: res.isOld0 ? 1n : 0n,
  };
}

describe("ppoi", () => {
  test("clean origin proves non-membership", async () => {
    await witness("ppoi", await inputFor(0xabcdn));
  });

  test("flagged origin cannot prove non-membership", async () => {
    const clean = await inputFor(0xabcdn);
    // Reuse a valid non-membership path but claim a flagged origin.
    await expect(witness("ppoi", { ...clean, origin: 0x2222n, originHash: c.hash(0x2222n, clean.blind) })).rejects.toThrow();
  });

  test("originHash must match the blinded origin", async () => {
    const i = await inputFor(0xabcdn);
    await expect(witness("ppoi", { ...i, originHash: randomField() })).rejects.toThrow();
  });

  test("non-boolean isOld0 cannot forge non-membership of a flagged origin", async () => {
    const F = smt.F, origin = 0x2222n, key = c.hash(origin);
    const res = await smt.find(F.e(key));
    expect(res.found).toBe(true);
    const siblings = res.siblings.map((s) => F.toObject(s));
    while (siblings.length < LEVELS) siblings.push(0n);
    const pow = (b: bigint, e: bigint) => { let r = 1n; b %= FIELD; while (e) { if (e & 1n) r = r * b % FIELD; b = b * b % FIELD; e >>= 1n; } return r; };
    const oldKey = 7n, oldValue = 0n;
    const realLeaf = c.hash(key, 1n, 1n), fakeLeaf = c.hash(oldKey, oldValue, 1n);
    const isOld0 = ((1n - realLeaf * pow(fakeLeaf, FIELD - 2n)) % FIELD + FIELD) % FIELD;
    const blind = randomField();
    await expect(witness("ppoi", {
      providerRoot: F.toObject(smt.root), originHash: c.hash(origin, blind),
      origin, blind, siblings, oldKey, oldValue, isOld0,
    })).rejects.toThrow();
  });
});
