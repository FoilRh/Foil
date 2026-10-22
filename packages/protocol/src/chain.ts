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

export const PACK_SITES = [
  { name: "Collector Crypt packs", url: "https://gacha.collectorcrypt.com" },
  { name: "Collector Crypt", url: "https://collectorcrypt.com" },
  { name: "The Card Wall", url: "https://thecardwall.com" },
] as const;

/** BIP-32 path for tin i (hardened, so a gifted tin key reveals no siblings). */
export const tinPath = (i: number) => `m/44'/60'/4040'/0'/${i}'`;
