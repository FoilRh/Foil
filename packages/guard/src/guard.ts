/**
 * Transaction guard (Build §5A.3). Every request a pack site makes to the injected
 * provider is decoded and checked here before the active tin signs anything.
 * Everything not explicitly allowed is refused.
 *
 * Call shapes are the live Collector Crypt contracts on RHC (read from chain, 2026-10-21):
 *   vault  pay(address token, uint256 amount, string memo)                           0x4a4bdb30
 *   vault  sellBack(address token, uint256 tokenId, uint256 amount, uint256 deadline,
 *                   uint256 nonce, bytes quoteSig)                                    0x60dee04b
 *   cards  approve(address to, uint256 tokenId)                                       0x095ea7b3
 *   cards  batchBurn(uint256[] tokenIds, string memo)  (shipping)                     0x77d8c887
 *   USDG   approve(address spender, uint256 amount)                                   0x095ea7b3
 *   USDG   transfer(address to, uint256 amount)  (shipping fee, allowlisted payees)   0xa9059cbb
 */
import { decodeFunctionData, getAddress, hexToString, isAddress, isHex, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";

export const CC_ABI = parseAbi([
  "function pay(address token, uint256 amount, string memo)",
  "function sellBack(address token, uint256 tokenId, uint256 amount, uint256 deadline, uint256 nonce, bytes quoteSig)",
]);
export const CARD_ABI = parseAbi([
  "function approve(address to, uint256 tokenId)",
  "function batchBurn(uint256[] tokenIds, string memo)",
]);
export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
]);
// The sell-back function's real name is not public; its selector is.
const SELL_BACK_SELECTOR = "0x60dee04b";

export interface Policy {
  chainId: number;
  /** The one tin exposed to the site. */
  tin: Address;
  usdg: Address;
  vault: Address;
  cards: Address;
  /** CC shipping fee payees (signed allowlist; empty until confirmed). */
  shippingPayees: Address[];
  /** Domains that may use the wallet (Build §5A.1). */
  domains: string[];
  /** The tin's current holdings (from the public snapshot / chain). */
  usdgBalance: bigint;
  cards_: bigint[];
}

export type Effect =
  | { kind: "usdg-out"; amount: bigint; to: Address }
  | { kind: "usdg-in"; amount: bigint }
  | { kind: "usdg-approve"; amount: bigint; spender: Address }
  | { kind: "card-out"; tokenId: bigint; to: Address }
  | { kind: "card-approve"; tokenId: bigint; to: Address }
  | { kind: "card-burn"; tokenIds: bigint[] }
  | { kind: "sign-in"; domain: string }
  | { kind: "authorization"; amount: bigint; to: Address };

export type Verdict = { allow: true; effects: Effect[]; summary: string } | { allow: false; reason: string };

const deny = (reason: string): Verdict => ({ allow: false, reason });
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const UNLIMITED = 2n ** 255n;

/** Methods that only read; they pass straight through. */
export const READ_METHODS = new Set([
  "eth_chainId", "net_version", "eth_accounts", "eth_requestAccounts", "eth_blockNumber", "eth_call", "eth_estimateGas",
  "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBlockByNumber", "eth_getLogs",
  "wallet_getCapabilities",
]);

/** Plain-English summary of a call's effects for the confirm prompt (amounts are USDG base units, shown as $). */
export function summarize(effects: Effect[]): string {
  const usd = (n: bigint) => `$${(Number(n) / 1e6).toFixed(2)}`;
  return effects.map((e) => {
    switch (e.kind) {
      case "usdg-out": return `−${usd(e.amount)} USDG`;
      case "usdg-in": return `+${usd(e.amount)} USDG`;
      case "usdg-approve": return `allow ${usd(e.amount)} USDG to be taken`;
      case "card-out": return `−1 card (#${e.tokenId})`;
      case "card-approve": return `let the vault take card #${e.tokenId}`;
      case "card-burn": return `burn ${e.tokenIds.length} card(s) for shipping`;
      case "sign-in": return `sign in to ${e.domain}`;
      case "authorization": return `authorize ${usd(e.amount)} USDG`;
    }
  }).join(", ");
}

const ok = (effects: Effect[]): Verdict => ({ allow: true, effects, summary: summarize(effects) });

/** eth_sendTransaction params[0]. */
export function checkTransaction(tx: { from?: string; to?: string; value?: string | bigint; data?: string; chainId?: string | number }, p: Policy): Verdict {
  if (!tx.to || !isAddress(tx.to)) return deny("contract creation and missing targets are refused");
  if (tx.from && !eq(tx.from, p.tin)) return deny("only the active tin can send");
  if (tx.chainId !== undefined && Number(tx.chainId) !== p.chainId) return deny("wrong network");
  if (tx.value !== undefined && BigInt(tx.value) !== 0n) return deny("sending ETH is refused");
  const data = (tx.data ?? "0x") as Hex;
  if (!isHex(data) || data.length < 10) return deny("plain transfers are refused");
  const to = getAddress(tx.to);

  if (eq(to, p.usdg)) {
    let d;
    try { d = decodeFunctionData({ abi: ERC20_ABI, data }); } catch { return deny("USDG call not allowed"); }
    if (d.functionName === "approve") {
      const [spender, amount] = d.args;
      if (!eq(spender, p.vault) && !p.shippingPayees.some((s) => eq(s, spender))) return deny("approval to an unknown spender");
      if (amount >= UNLIMITED) return deny("unlimited approvals are refused");
      if (amount > p.usdgBalance) return deny("approval exceeds what the tin holds");
      return ok([{ kind: "usdg-approve", amount, spender }]);
    }
    const [dest, amount] = d.args;
    if (!p.shippingPayees.some((s) => eq(s, dest))) return deny("USDG may only go to the vault or a shipping payee");
    if (amount > p.usdgBalance) return deny("more than the tin holds");
    return ok([{ kind: "usdg-out", amount, to: dest }]);
  }

  if (eq(to, p.vault)) {
    let d;
    try {
      d = data.slice(0, 10).toLowerCase() === SELL_BACK_SELECTOR
        ? { functionName: "sellBack" as const, args: decodeSellBack(data) }
        : decodeFunctionData({ abi: CC_ABI, data });
    } catch { return deny("vault call not allowed"); }
    if (d.functionName === "pay") {
      const [token, amount] = d.args as readonly [Address, bigint, string];
      if (!eq(token, p.usdg)) return deny("payment must be in USDG");
      if (amount === 0n || amount > p.usdgBalance) return deny("payment exceeds what the tin holds");
      return ok([{ kind: "usdg-out", amount, to: p.vault }]);
    }
    const [token, tokenId, amount] = d.args as readonly [Address, bigint, bigint, bigint, bigint, Hex];
    if (!eq(token, p.usdg)) return deny("sell-back must pay USDG");
    if (!p.cards_.includes(tokenId)) return deny("the tin does not hold that card");
    return ok([{ kind: "card-out", tokenId, to: p.vault }, { kind: "usdg-in", amount }]);
  }

  if (eq(to, p.cards)) {
    let d;
    try { d = decodeFunctionData({ abi: CARD_ABI, data }); } catch { return deny("card call not allowed"); }
    if (d.functionName === "approve") {
      const [spender, tokenId] = d.args;
      if (!eq(spender, p.vault)) return deny("cards may only be approved to the vault");
      if (!p.cards_.includes(tokenId)) return deny("the tin does not hold that card");
      return ok([{ kind: "card-approve", tokenId, to: spender }]);
    }
    const [ids] = d.args;
    if (!ids.length || ids.some((id) => !p.cards_.includes(id))) return deny("can only burn the tin's own cards");
    return ok([{ kind: "card-burn", tokenIds: [...ids] }]);
  }

  return deny("that contract is not on the allowlist");
}

/** The sell-back's argument layout, under its real (unpublished) selector. */
const SELL_BACK_ABI_SELECTOR = toFunctionSelector("sellBack(address,uint256,uint256,uint256,uint256,bytes)");
function decodeSellBack(data: Hex) {
  const renamed = `${SELL_BACK_ABI_SELECTOR}${data.slice(10)}` as Hex;
  return decodeFunctionData({ abi: CC_ABI, data: renamed }).args as readonly [Address, bigint, bigint, bigint, bigint, Hex];
}

/** personal_sign: only a sign-in message for an allowed domain, for the active tin, on RHC. */
export function checkPersonalSign(params: unknown[], p: Policy, origin: string): Verdict {
  const [raw, addr] = params as [string, string];
  if (!addr || !eq(addr, p.tin)) return deny("only the active tin can sign");
  const text = isHex(raw) ? safeText(raw) : String(raw);
  if (text === null) return deny("binary messages are refused");
  const m = /^(\S+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n/.exec(text);
  if (!m) return deny("only sign-in messages are allowed");
  const domain = m[1]!;
  if (!p.domains.includes(domain) || hostOf(origin) !== domain) return deny("sign-in for another site is refused");
  if (!eq(m[2]!, p.tin)) return deny("sign-in for another address is refused");
  const chain = /\nChain ID: (\d+)/.exec(text);
  if (chain && Number(chain[1]) !== p.chainId) return deny("wrong network");
  return ok([{ kind: "sign-in", domain }]);
}

/** eth_signTypedData_v4: only EIP-3009 / EIP-2612 USDG to allowed spenders for an exact amount. */
export function checkTypedData(params: unknown[], p: Policy): Verdict {
  const [addr, json] = params as [string, string];
  if (!addr || !eq(addr, p.tin)) return deny("only the active tin can sign");
  let td: { domain?: { chainId?: number | string; verifyingContract?: string }; primaryType?: string; message?: Record<string, string> };
  try { td = typeof json === "string" ? JSON.parse(json) : (json as typeof td); } catch { return deny("unreadable typed data"); }
  if (!td.domain?.verifyingContract || !eq(td.domain.verifyingContract, p.usdg)) return deny("typed data must be for USDG");
  if (Number(td.domain.chainId) !== p.chainId) return deny("wrong network");
  const msg = td.message ?? {};
  const allowedTo = (a: string | undefined) => !!a && (eq(a, p.vault) || p.shippingPayees.some((s) => eq(s, a)));
  if (td.primaryType === "TransferWithAuthorization" || td.primaryType === "ReceiveWithAuthorization") {
    if (!eq(msg.from ?? "", p.tin)) return deny("authorization must be from the active tin");
    if (!allowedTo(msg.to)) return deny("authorization to an unknown payee");
    const v = BigInt(msg.value ?? "0");
    if (v === 0n || v > p.usdgBalance) return deny("authorization exceeds what the tin holds");
    return ok([{ kind: "authorization", amount: v, to: getAddress(msg.to!) }]);
  }
  if (td.primaryType === "Permit") {
    if (!eq(msg.owner ?? "", p.tin)) return deny("permit must be from the active tin");
    if (!allowedTo(msg.spender)) return deny("permit to an unknown spender");
    const v = BigInt(msg.value ?? "0");
    if (v >= UNLIMITED || v > p.usdgBalance) return deny("permit exceeds what the tin holds");
    return ok([{ kind: "usdg-approve", amount: v, spender: getAddress(msg.spender!) }]);
  }
  return deny("that signature type is refused");
}

/** Route one provider request. Read methods pass; signing methods go through the checks. */
export function checkRequest(method: string, params: unknown[], p: Policy, origin: string): Verdict {
  if (!p.domains.includes(hostOf(origin))) return deny("this site may not use the wallet");
  if (READ_METHODS.has(method)) return ok([]);
  switch (method) {
    case "eth_sendTransaction": return checkTransaction((params[0] ?? {}) as Parameters<typeof checkTransaction>[0], p);
    case "personal_sign": return checkPersonalSign(params, p, origin);
    case "eth_signTypedData_v4": return checkTypedData(params, p);
    case "wallet_switchEthereumChain": {
      const id = Number((params[0] as { chainId?: string })?.chainId);
      return id === p.chainId ? ok([]) : deny("only Robinhood Chain is available");
    }
    default: return deny(`${method} is not available`);
  }
}

/**
 * Simulation post-check (Build §5A.3): given the Transfer logs a simulated transaction
 * would emit, refuse if anything would leave the tin for an address outside the allowlist.
 */
export function checkSimulatedTransfers(logs: { address: string; topics: string[] }[], p: Policy): Verdict {
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const allowed = [p.vault, ...p.shippingPayees, "0x0000000000000000000000000000000000000000"];
  for (const l of logs) {
    if (l.topics[0]?.toLowerCase() !== TRANSFER || l.topics.length < 3) continue;
    const from = `0x${l.topics[1]!.slice(26)}`;
    const to = `0x${l.topics[2]!.slice(26)}`;
    if (eq(from, p.tin) && !allowed.some((a) => eq(a, to))) return deny(`simulation: assets would leave the tin to ${to}`);
  }
  return ok([]);
}

function hostOf(origin: string) {
  try { return new URL(origin).hostname; } catch { return ""; }
}
function safeText(hex: Hex): string | null {
  try {
    const s = hexToString(hex);
    return /[\u0000-\u0008\u000e-\u001f]/.test(s) ? null : s;
  } catch { return null; }
}

/** Card token IDs a transaction refers to (so a server can check ownership on-chain). */
export function tokenIdsIn(tx: { to?: string; data?: string }, p: Pick<Policy, "vault" | "cards">): bigint[] {
  const data = (tx.data ?? "0x") as Hex;
  if (!tx.to || data.length < 10) return [];
  try {
    if (eq(tx.to, p.vault) && data.slice(0, 10).toLowerCase() === SELL_BACK_SELECTOR) return [decodeSellBack(data)[1]];
    if (eq(tx.to, p.cards)) {
      const d = decodeFunctionData({ abi: CARD_ABI, data });
      return d.functionName === "approve" ? [d.args[1]] : [...d.args[0]];
    }
  } catch {
    return [];
  }
  return [];
}
