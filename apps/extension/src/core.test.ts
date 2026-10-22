import { describe, expect, test } from "bun:test";
import { encodeFunctionData, type Address } from "viem";
import { CC_ABI, ERC20_ABI, type Policy } from "@foil/guard";
import { cardLanded, decide, fromWire, pacScript, toWire, type Session } from "./core";

const TIN = "0x1111111111111111111111111111111111111111" as Address;
const policy: Policy = {
  chainId: 4663, tin: TIN, usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  vault: "0x4d56B148624e17FD53c08D1C4998e8e3945bDE28", cards: "0xb47a306bD89E8b6fA2b14f553E534AdcD7Cc337F",
  shippingPayees: [], domains: ["gacha.collectorcrypt.com", "collectorcrypt.com", "thecardwall.com"],
  usdgBalance: 25_000_000n, cards_: [],
};
const SITE = "https://gacha.collectorcrypt.com";
const on: Session = { policy, pausedReason: null };
const off: Session = { policy: null, pausedReason: "Next tin arrives in the coming round (≤ 10 min)." };

describe("extension decisions", () => {
  test("only the active tin and only RHC are exposed", () => {
    expect(decide(on, SITE, "eth_requestAccounts", [])).toEqual({ kind: "result", result: [TIN] });
    expect(decide(on, SITE, "eth_chainId", [])).toEqual({ kind: "result", result: "0x1237" });
    expect(decide(on, "https://evil.example", "eth_accounts", []).kind).toBe("error");
  });

  test("with no ready tin the site gets no account and a clear pause", () => {
    expect(decide(off, SITE, "eth_accounts", [])).toEqual({ kind: "result", result: [] });
    const d = decide(off, SITE, "eth_requestAccounts", []);
    expect(d.kind === "error" && d.message).toContain("coming round");
  });

  test("reads are forwarded; a pack payment needs confirmation; an attack is blocked", () => {
    expect(decide(on, SITE, "eth_call", [{ to: policy.vault, data: "0x" }]).kind).toBe("read");
    const pay = decide(on, SITE, "eth_sendTransaction", [{ from: TIN, to: policy.vault, data: encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [policy.usdg, 25_000_000n, "m"] }) }]);
    expect(pay.kind === "confirm" && pay.verdict.summary).toBe("−$25.00 USDG");
    const steal = decide(on, SITE, "eth_sendTransaction", [{ from: TIN, to: policy.usdg, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: ["0xbadbadbadbadbadbadbadbadbadbadbadbadbad0", 1n] }) }]);
    expect(steal.kind).toBe("error");
  });

  test("policy survives chrome messaging (bigints as strings)", () => {
    expect(fromWire(JSON.parse(JSON.stringify(toWire(policy))))).toEqual(policy);
  });

  test("rotation trigger: an ERC-721 Transfer into the active tin", () => {
    const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
    expect(cardLanded([{ topics: [T, pad("0x0000000000000000000000000000000000000000"), pad(TIN), pad("0x3e8")] }], TIN)).toBe(true);
    expect(cardLanded([{ topics: [T, pad(TIN), pad(policy.vault), pad("0x3e8")] }], TIN)).toBe(false); // leaving, not landing
    expect(cardLanded([{ topics: [T, pad(TIN), pad(policy.vault)] }], TIN)).toBe(false); // ERC-20, not a card
  });
});

test("PAC routes only the pack domains through the tunnel", () => {
  const FindProxyForURL = new Function("url", "host", "dnsDomainIs",
    `${pacScript("HTTPS tunnel.foil.example:443")}; return FindProxyForURL(url, host);`) as (u: string, h: string, d: (h: string, d: string) => boolean) => string;
  const dnsDomainIs = (h: string, d: string) => h.endsWith(`.${d}`);
  expect(FindProxyForURL("https://gacha.collectorcrypt.com/", "gacha.collectorcrypt.com", dnsDomainIs)).toBe("HTTPS tunnel.foil.example:443");
  expect(FindProxyForURL("https://collectorcrypt.com/", "collectorcrypt.com", dnsDomainIs)).toBe("HTTPS tunnel.foil.example:443");
  expect(FindProxyForURL("https://example.com/", "example.com", dnsDomainIs)).toBe("DIRECT");
});
