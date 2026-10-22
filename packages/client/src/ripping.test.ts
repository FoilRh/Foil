import { expect, test } from "bun:test";
import { readyTins } from "./ripping";
import type { TinRec } from "./wallet";

const tin = (index: number, extra: Partial<TinRec> = {}): TinRec => ({
  index, address: `0x${String(index).padStart(40, "0")}`, roundId: "1", reqIdx: index, size: "25000000", reserved: "0",
  state: "Funded", createdAt: "", usdg: "25000000", ...extra,
});

test("one tin per rip: only funded, unused, card-free, non-gift tins with USDG, oldest first", () => {
  const tins = [
    tin(4), tin(1), tin(2, { ripped: true }), tin(3, { cards: ["7"] }), tin(5, { gift: { note: "" } }),
    tin(6, { state: "Requested" }), tin(7, { usdg: "0" }),
  ];
  expect(readyTins(tins).map((t) => t.index)).toEqual([1, 4]);
});
