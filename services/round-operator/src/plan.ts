import type { Address, Hex } from "viem";

export interface Reveal { tin: Address; salt: Hex }

/**
 * Reveal list for executeRound, sorted by tin address ascending (the order carries no
 * information), only for requests still pending. Not deduplicated: one (tin, salt) can
 * open two requests of different sizes, and the pool funds one pending request per
 * reveal and returns the ETH of any extra reveal.
 */
export function planExecution(reveals: Reveal[], isPending: (r: Reveal) => boolean) {
  const sorted = reveals.filter(isPending).sort((a, b) => (BigInt(a.tin) < BigInt(b.tin) ? -1 : BigInt(a.tin) > BigInt(b.tin) ? 1 : 0));
  return { tins: sorted.map((r) => r.tin), salts: sorted.map((r) => r.salt) };
}
