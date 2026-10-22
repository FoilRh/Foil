import { expect, test } from "bun:test";
import { depositFee, formatUsdg, parseUsdg, sendBackFee, shouldCloseRound, tinFundingFee } from ".";

test("money round-trips and rejects bad input", () => {
  expect(parseUsdg("25")).toBe(25_000_000n);
  expect(parseUsdg("0.000001")).toBe(1n);
  expect(formatUsdg(25_500_000n)).toBe("25.5");
  expect(formatUsdg(-1n)).toBe("-0.000001");
  for (const bad of ["-1", "1.0000001", "abc", ""]) expect(() => parseUsdg(bad)).toThrow();
});

test("fees round up and match the Build", () => {
  expect(depositFee(30_000_000n)).toBe(45_000n); // 0.15% of $30
  expect(depositFee(1n)).toBe(1n); // never zero on a non-zero amount
  expect(tinFundingFee(25_000_000n)).toBe(37_500n + 200_000n);
  expect(sendBackFee(25_000_000n, 25_000_000n)).toBe(0n);
  expect(sendBackFee(30_000_000n, 25_000_000n)).toBe(12_500n);
});

test("round close rule matches StashPool.canClose", () => {
  const first = new Date("2026-10-21T10:00:30Z");
  const at = (iso: string) => new Date(iso);
  expect(shouldCloseRound(first, at("2026-10-21T10:10:00Z"), 8)).toBe(true);
  expect(shouldCloseRound(first, at("2026-10-21T10:11:59Z"), 8)).toBe(true);
  expect(shouldCloseRound(first, at("2026-10-21T10:12:00Z"), 8)).toBe(false); // outside the window
  expect(shouldCloseRound(first, at("2026-10-21T10:10:00Z"), 7)).toBe(false);
  expect(shouldCloseRound(first, at("2026-10-21T10:20:30Z"), 9)).toBe(true); // rolled forward
  expect(shouldCloseRound(first, at("2026-10-21T10:30:29Z"), 1)).toBe(false);
  expect(shouldCloseRound(first, at("2026-10-21T10:30:30Z"), 1)).toBe(true);
  expect(shouldCloseRound(first, at("2026-10-21T11:00:00Z"), 0)).toBe(false);
});

import { regionAllowed, regionFromLocale } from "./regions";

test("region rules: declared region and device locale both count", () => {
  expect(regionFromLocale("nl-BE")).toBe("BE");
  expect(regionFromLocale("en_US")).toBe("US");
  expect(regionFromLocale("fr")).toBeNull();
  expect(regionAllowed("US", "en-US").allowed).toBe(true);
  expect(regionAllowed(null, "en-US").allowed).toBe(false); // must declare
  expect(regionAllowed("BE", "en-US").allowed).toBe(false); // declared
  expect(regionAllowed("US", "nl-BE").allowed).toBe(false); // locale
});

import { applySnapshotDiff, diffSnapshots } from "./snapshot";

test("snapshot diffs carry only changed tins and rebuild the full set", () => {
  const t = (tin: string, usdg: string) => ({ tin, roundId: "1", funded: "25000000", usdg, cards: [] as string[] });
  const base = { block: "100", asOf: "a", tins: [t("0x01", "25000000"), t("0x02", "25000000")] };
  const latest = { block: "200", asOf: "b", tins: [t("0x01", "0"), t("0x02", "25000000"), t("0x03", "10000000")] };
  const d = diffSnapshots(base, latest);
  expect(d.kind === "diff" && d.changed.map((x) => x.tin)).toEqual(["0x01", "0x03"]);
  expect(applySnapshotDiff(base, d)).toEqual(latest);
  expect(() => applySnapshotDiff({ ...base, block: "99" }, d)).toThrow();
  expect(diffSnapshots(null, latest)).toEqual({ kind: "full", snapshot: latest });
});
