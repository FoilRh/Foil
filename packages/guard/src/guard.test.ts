/**
 * Build §12 "Browser-mode guard: a malicious-transaction corpus is 100% blocked".
 * The allowed set uses the live CC call shapes (the sell-back below is real mainnet
 * calldata, tx 0x07b96a57…c796, re-pointed at our test tin's card).
 */
import { describe, expect, test } from "bun:test";
import { encodeFunctionData, parseAbi, toHex, type Address, type Hex } from "viem";
import { CARD_ABI, CC_ABI, ERC20_ABI, checkRequest, checkSimulatedTransfers, type Policy } from "./guard";

const TIN = "0x1111111111111111111111111111111111111111" as Address;
const ATTACKER = "0xbadbadbadbadbadbadbadbadbadbadbadbadbad0" as Address;
const p: Policy = {
  chainId: 4663,
  tin: TIN,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  vault: "0x4d56B148624e17FD53c08D1C4998e8e3945bDE28",
  cards: "0xb47a306bD89E8b6fA2b14f553E534AdcD7Cc337F",
  shippingPayees: ["0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e"],
  domains: ["gacha.collectorcrypt.com", "collectorcrypt.com", "thecardwall.com"],
  usdgBalance: 50_000_000n,
  cards_: [5855n],
};
const SITE = "https://gacha.collectorcrypt.com";
const tx = (to: Address, data: Hex, extra: Record<string, unknown> = {}): [string, unknown[]] => ["eth_sendTransaction", [{ from: TIN, to, data, ...extra }]];

// Real mainnet sell-back calldata (selector 0x60dee04b): USDG, card 5855, 30.60 USDG, deadline, nonce, quote sig.
const REAL_SELL_BACK = ("0x60dee04b"
  + "0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168"
  + "00000000000000000000000000000000000000000000000000000000000016df"
  + "0000000000000000000000000000000000000000000000000000000001d2eb40"
  + "000000000000000000000000000000000000000000000000000000006ad89b15"
  + "00000000000000000000000000000000000000000000000000000000000021e6"
  + "00000000000000000000000000000000000000000000000000000000000000c0"
  + "0000000000000000000000000000000000000000000000000000000000000041"
  + "177927623121ee296e39d7abcce65c9f817d1e45f937a82761db2263f822d4d8"
  + "0d68c2c676396ba38ff95eb167343ecb7e85cf7558c35e942138e6157de7398e"
  + "1b00000000000000000000000000000000000000000000000000000000000000") as Hex;

const siwe = (domain: string, addr: string, chain = 4663) =>
  toHex(`${domain} wants you to sign in with your Ethereum account:\n${addr}\n\nSign in\n\nURI: https://${domain}\nVersion: 1\nChain ID: ${chain}\nNonce: abc\nIssued At: 2026-10-21T00:00:00Z`);
const typed = (primaryType: string, message: Record<string, unknown>, verifyingContract: string = p.usdg, chainId = 4663) =>
  JSON.stringify({ domain: { name: "Global Dollar", version: "1", chainId, verifyingContract }, primaryType, types: {}, message });

describe("allowed: the ordinary rip, sell-back, sign-in and shipping flows", () => {
  const cases: [string, [string, unknown[]], string][] = [
    ["approve the vault for the pack price", tx(p.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [p.vault, 25_000_000n] })), "allow $25.00"],
    ["pay for a pack", tx(p.vault, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [p.usdg, 25_000_000n, "memo-123"] })), "−$25.00 USDG"],
    ["approve our card to the vault", tx(p.cards, encodeFunctionData({ abi: CARD_ABI, functionName: "approve", args: [p.vault, 5855n] })), "card #5855"],
    ["real mainnet sell-back calldata", tx(p.vault, REAL_SELL_BACK), "+$30.60 USDG"],
    ["burn our card for shipping", tx(p.cards, encodeFunctionData({ abi: CARD_ABI, functionName: "batchBurn", args: [[5855n], "ship-1"] })), "burn 1"],
    ["pay the shipping fee", tx(p.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [p.shippingPayees[0]!, 12_000_000n] })), "−$12.00"],
    ["sign in to the pack site", ["personal_sign", [siwe("gacha.collectorcrypt.com", TIN), TIN]], "sign in"],
    ["EIP-3009 to the vault for the exact price", ["eth_signTypedData_v4", [TIN, typed("TransferWithAuthorization", { from: TIN, to: p.vault, value: "25000000" })]], "authorize $25.00"],
    ["read calls pass", ["eth_call", [{ to: p.vault, data: "0x" }]], ""],
  ];
  for (const [name, [method, params], summary] of cases) {
    test(name, () => {
      const v = checkRequest(method, [...params], p, SITE);
      expect(v.allow).toBe(true);
      if (v.allow) expect(v.summary).toContain(summary);
    });
  }
});

describe("malicious corpus: every request is refused", () => {
  const erc20 = parseAbi(["function transferFrom(address,address,uint256)", "function increaseAllowance(address,uint256)"]);
  const nft = parseAbi(["function setApprovalForAll(address,bool)", "function transferFrom(address,address,uint256)", "function safeTransferFrom(address,address,uint256)"]);
  const corpus: [string, string, unknown[], string?][] = [
    ["unlimited USDG approval", ...tx(p.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [p.vault, 2n ** 256n - 1n] }))],
    ["approval to an attacker", ...tx(p.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [ATTACKER, 1n] }))],
    ["approval beyond the balance", ...tx(p.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [p.vault, 60_000_000n] }))],
    ["USDG transfer to an attacker", ...tx(p.usdg, encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [ATTACKER, 1n] }))],
    ["USDG transferFrom", ...tx(p.usdg, encodeFunctionData({ abi: erc20, functionName: "transferFrom", args: [TIN, ATTACKER, 1n] }))],
    ["increaseAllowance", ...tx(p.usdg, encodeFunctionData({ abi: erc20, functionName: "increaseAllowance", args: [ATTACKER, 1n] }))],
    ["setApprovalForAll on cards", ...tx(p.cards, encodeFunctionData({ abi: nft, functionName: "setApprovalForAll", args: [ATTACKER, true] }))],
    ["card transferFrom to attacker", ...tx(p.cards, encodeFunctionData({ abi: nft, functionName: "transferFrom", args: [TIN, ATTACKER, 5855n] }))],
    ["card safeTransferFrom", ...tx(p.cards, encodeFunctionData({ abi: nft, functionName: "safeTransferFrom", args: [TIN, ATTACKER, 5855n] }))],
    ["approve a card to an attacker", ...tx(p.cards, encodeFunctionData({ abi: CARD_ABI, functionName: "approve", args: [ATTACKER, 5855n] }))],
    ["burn a card the tin does not hold", ...tx(p.cards, encodeFunctionData({ abi: CARD_ABI, functionName: "batchBurn", args: [[1n], "x"] }))],
    ["pay in another token", ...tx(p.vault, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [ATTACKER, 1n, "m"] }))],
    ["pay more than the tin holds", ...tx(p.vault, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [p.usdg, 51_000_000n, "m"] }))],
    ["sell back a card the tin does not hold", ...tx(p.vault, REAL_SELL_BACK.replace("16df", "16e0") as Hex)],
    ["unknown vault function", ...tx(p.vault, "0xd9caed120000000000000000000000000000000000000000000000000000000000000000")],
    ["call to an unknown contract", ...tx(ATTACKER, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [p.usdg, 1n, "m"] }))],
    ["sending ETH", ...tx(p.vault, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [p.usdg, 1n, "m"] }), { value: "0x1" })],
    ["plain ETH transfer", ...tx(ATTACKER, "0x", { value: "0x5af3107a4000" })],
    ["contract creation", "eth_sendTransaction", [{ from: TIN, data: "0x6080" }]],
    ["sending from another address", "eth_sendTransaction", [{ from: ATTACKER, to: p.vault, data: encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [p.usdg, 1n, "m"] }) }]],
    ["wrong chain id in the tx", ...tx(p.vault, encodeFunctionData({ abi: CC_ABI, functionName: "pay", args: [p.usdg, 1n, "m"] }), { chainId: "0x1" })],
    ["raw eth_sign", "eth_sign", [TIN, "0x" + "ab".repeat(32)]],
    ["personal_sign of arbitrary text", "personal_sign", [toHex("Transfer all my funds"), TIN]],
    ["sign-in for another site", "personal_sign", [siwe("evil.example", TIN), TIN]],
    ["sign-in for another address", "personal_sign", [siwe("gacha.collectorcrypt.com", ATTACKER), TIN]],
    ["sign-in on another chain", "personal_sign", [siwe("gacha.collectorcrypt.com", TIN, 1), TIN]],
    ["EIP-3009 to an attacker", "eth_signTypedData_v4", [TIN, typed("TransferWithAuthorization", { from: TIN, to: ATTACKER, value: "1" })]],
    ["EIP-3009 beyond the balance", "eth_signTypedData_v4", [TIN, typed("TransferWithAuthorization", { from: TIN, to: p.vault, value: "60000000" })]],
    ["unlimited permit", "eth_signTypedData_v4", [TIN, typed("Permit", { owner: TIN, spender: p.vault, value: (2n ** 256n - 1n).toString() })]],
    ["permit to an attacker", "eth_signTypedData_v4", [TIN, typed("Permit", { owner: TIN, spender: ATTACKER, value: "1" })]],
    ["Permit2 / other token typed data", "eth_signTypedData_v4", [TIN, typed("PermitSingle", { spender: ATTACKER }, "0x000000000022D473030F116dDEE9F6B43aC78BA3")]],
    ["typed data on another chain", "eth_signTypedData_v4", [TIN, typed("TransferWithAuthorization", { from: TIN, to: p.vault, value: "1" }, p.usdg, 1)]],
    ["switch to another chain", "wallet_switchEthereumChain", [{ chainId: "0x1" }]],
    ["add a chain", "wallet_addEthereumChain", [{ chainId: "0x1" }]],
    ["watch an asset", "wallet_watchAsset", [{}]],
    ["eth_signTransaction", "eth_signTransaction", [{}]],
  ];
  for (const [name, method, params] of corpus) {
    test(name, () => expect(checkRequest(method, params, p, SITE).allow).toBe(false));
  }

  test("an unlisted site gets nothing, not even reads", () => {
    expect(checkRequest("eth_accounts", [], p, "https://evil.example").allow).toBe(false);
  });
});

describe("simulation post-check", () => {
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
  test("assets leaving the tin to the vault pass; to anyone else, blocked", () => {
    expect(checkSimulatedTransfers([{ address: p.usdg, topics: [TRANSFER, topic(TIN), topic(p.vault)] }], p).allow).toBe(true);
    expect(checkSimulatedTransfers([{ address: p.usdg, topics: [TRANSFER, topic(TIN), topic(ATTACKER)] }], p).allow).toBe(false);
    expect(checkSimulatedTransfers([{ address: p.cards, topics: [TRANSFER, topic(TIN), topic(ATTACKER), topic("0x16df")] }], p).allow).toBe(false);
  });
});
