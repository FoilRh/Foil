/**
 * Chain facts from the Foil Build (2026-10-08). Collector Crypt redeploys, so live
 * addresses are read from its API and must match these pins (Build §0).
 */
export const FOIL_CHAIN_ID = 4663 as const;
/** Robinhood Chain testnet: no USDG or Collector Crypt there; Foil deploys a mock USDG. */
export const RHC_TESTNET_CHAIN_ID = 46630 as const;
export const FOIL_CHAINS = [FOIL_CHAIN_ID, RHC_TESTNET_CHAIN_ID] as const;
export type FoilChainId = (typeof FOIL_CHAINS)[number];

export const USDG = {
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
  eip712: { name: "Global Dollar", version: "1" },
} as const;

/** Pinned Collector Crypt contracts on RHC. Updates need a 2-of-3 signed allowlist. */
export const CC_PINNED = {
  gachaVault: "0x4d56B148624e17FD53c08D1C4998e8e3945bDE28",
  cardNft: "0xb47a306bD89E8b6fA2b14f553E534AdcD7Cc337F",
} as const;

/**
 * Collector Crypt sells packs against a Solana USDC balance, not USDG on RHC. A tin funds that
 * balance through Relay (relay.link): USDG on RHC into Relay's depository, USDC out on Solana.
 */
export const RELAY = {
  api: "https://api.relay.link",
  /** RelayDepository on RHC: depositErc20(address depositor, address token, uint256 amount, bytes32 id). */
  depository: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
  solanaChainId: 792703809,
  solanaUsdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export const PACK_SITES = [
  { name: "Collector Crypt packs", url: "https://gacha.collectorcrypt.com" },
  { name: "Collector Crypt", url: "https://collectorcrypt.com" },
  { name: "The Card Wall", url: "https://thecardwall.com" },
] as const;

/** BIP-32 path for tin i (hardened, so a gifted tin key reveals no siblings). */
export const tinPath = (i: number) => `m/44'/60'/4040'/0'/${i}'`;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A Solana address: base58 that decodes to exactly 32 bytes (catches a mistyped paste). */
export function isSolanaAddress(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  let bytes = 0;
  for (; n > 0n; n >>= 8n) bytes++;
  const zeros = s.length - s.replace(/^1+/, "").length; // leading '1's are leading zero bytes
  return bytes + zeros === 32;
}
