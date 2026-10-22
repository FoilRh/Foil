import { expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { decodeGiftFragment, encodeGiftLink } from "./gift";

test("gift links keep the key in the fragment and round-trip", () => {
  const key = `0x${"42".repeat(32)}` as const;
  const link = encodeGiftLink("https://foil.example", key, "Happy birthday 🎁");
  const url = new URL(link);
  expect(url.pathname).toBe("/gift/");
  expect(url.search).toBe(""); // nothing outside the fragment
  const g = decodeGiftFragment(url.hash)!;
  expect(g.key).toBe(key);
  expect(g.address).toBe(privateKeyToAccount(key).address);
  expect(g.note).toBe("Happy birthday 🎁");
  expect(decodeGiftFragment("#v2.abc")).toBeNull();
  expect(decodeGiftFragment("#v1.!!")).toBeNull();
});
