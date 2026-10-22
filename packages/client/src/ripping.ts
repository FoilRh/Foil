/**
 * Browser-mode ripping helpers (Build §5A.2): one tin per rip, chosen from ready tins,
 * never reused; the guard policy handed to the extension for the active tin.
 */
import type { Address } from "viem";
import type { Policy } from "@foil/guard";
import type { TinRec } from "./wallet";

export const PACK_DOMAINS = ["gacha.collectorcrypt.com", "collectorcrypt.com", "thecardwall.com"];
export const NO_READY_TIN = "Next tin arrives in the coming round (usually within 10 to 30 minutes).";

/** A funded tin that has never ripped, holds no card, is not a gift, and holds USDG. */
export function readyTins(tins: TinRec[]): TinRec[] {
  return tins
    .filter((t) => t.state === "Funded" && !t.gift && !t.ripped && !(t.cards?.length) && BigInt(t.usdg ?? t.size) > 0n)
    .sort((a, b) => a.index - b.index);
}

export interface CcConfig { chainId: number; usdg: Address; vault: Address; cards: Address; shippingPayees: Address[] }

/** Guard policy for ripping with tin `t`: CC contracts, pack domains and its current holdings. */
export function policyFor(t: TinRec, cc: CcConfig, holdings: { usdg: bigint; cards: bigint[] }): Policy {
  return {
    chainId: cc.chainId, tin: t.address, usdg: cc.usdg, vault: cc.vault, cards: cc.cards, shippingPayees: cc.shippingPayees,
    domains: PACK_DOMAINS, usdgBalance: holdings.usdg, cards_: holdings.cards,
  };
}
