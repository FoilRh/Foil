/**
 * Foil extension core (Build §5A, §5A fallback "Foil browser extension"). Pure logic:
 * decides what to do with each provider request from a pack site. The background
 * worker wires it to Chrome; tests drive it directly.
 *
 * Keys never live here. Approved requests go to the user's Foil tab, which holds the
 * keys, re-checks with the same guard and signs; everything leaves through OHTTP.
 */
import { checkRequest, type Policy, type Verdict } from "@foil/guard";

export const FOIL_CHAIN_HEX = "0x1237"; // 4663
export const PACK_DOMAINS = ["gacha.collectorcrypt.com", "collectorcrypt.com", "thecardwall.com"];
export const PACK_ORIGINS = PACK_DOMAINS.map((d) => `https://${d}`);

/** Policy as it crosses chrome messaging (JSON: bigints as strings). */
export type WirePolicy = Omit<Policy, "usdgBalance" | "cards_"> & { usdgBalance: string; cards_: string[] };
/** WirePolicy → Policy (strings back to bigints). */
export const fromWire = (w: WirePolicy): Policy => ({ ...w, usdgBalance: BigInt(w.usdgBalance), cards_: w.cards_.map(BigInt) });
/** Policy → WirePolicy (bigints to strings) for chrome messaging. */
export const toWire = (p: Policy): WirePolicy => ({ ...p, usdgBalance: p.usdgBalance.toString(), cards_: p.cards_.map(String) });

export interface Session {
  /** Set while the Foil tab is connected and has handed us a ready tin. */
  policy: Policy | null;
  /** Shown when no ready tin is left (Build §5A.2 step 3). */
  pausedReason: string | null;
}

export type Decision =
  | { kind: "result"; result: unknown }
  | { kind: "read" } // forward to the Foil tab's OHTTP rpc
  | { kind: "confirm"; verdict: Extract<Verdict, { allow: true }> } // ask the user, then the Foil tab signs
  | { kind: "error"; code: number; message: string };

const err = (code: number, message: string): Decision => ({ kind: "error", code, message });

/** EIP-1193 errors: 4001 user rejected, 4100 unauthorized, 4200 unsupported, 4900 disconnected. */
export function decide(s: Session, origin: string, method: string, params: unknown[]): Decision {
  const host = (() => { try { return new URL(origin).hostname; } catch { return ""; } })();
  if (!PACK_DOMAINS.includes(host)) return err(4100, "This site may not use the Foil wallet.");
  if (method === "eth_chainId") return { kind: "result", result: FOIL_CHAIN_HEX };
  if (method === "net_version") return { kind: "result", result: "4663" };
  if (!s.policy) {
    if (method === "eth_accounts") return { kind: "result", result: [] };
    return err(4900, s.pausedReason ?? "Open Foil and start ripping to connect a fresh tin.");
  }
  // Only the active tin, ever (Build §5A.2 step 1).
  if (method === "eth_accounts" || method === "eth_requestAccounts") return { kind: "result", result: [s.policy.tin] };
  const v = checkRequest(method, params, s.policy, origin);
  if (!v.allow) return err(4200, `Foil blocked this request: ${v.reason}`);
  if (v.effects.length === 0) return { kind: "read" };
  return { kind: "confirm", verdict: v };
}

/** Did a card just land in the active tin? (ERC-721 Transfer to the tin.) */
export function cardLanded(logs: { topics: string[] }[], tin: string): boolean {
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const t = `0x${tin.slice(2).toLowerCase().padStart(64, "0")}`;
  return logs.some((l) => l.topics.length === 4 && l.topics[0]?.toLowerCase() === TRANSFER && l.topics[2]?.toLowerCase() === t);
}

/**
 * Route only the pack domains through Foil's tunnel relay (Build §5A.1: "sites see the
 * relay, not the user"; DNS resolves at the relay). Everything else stays DIRECT.
 */
export function pacScript(proxy: string): string {
  const hosts = PACK_DOMAINS.map((d) => `dnsDomainIs(host, "${d}") || host === "${d}"`).join(" || ");
  return `function FindProxyForURL(url, host) { if (${hosts}) return "${proxy}"; return "DIRECT"; }`;
}

/** What the extension wipes between tins so a site cannot link them (Build §5A.1). */
export const WIPE = {
  origins: PACK_ORIGINS,
  dataTypes: { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true, webSQL: true },
};
