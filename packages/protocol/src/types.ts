import type { FoilChainId } from "./chain";

export type IntegrationMode = "browser" | "key";
export type RequestState = "Pending" | "Executed" | "SelfExecuted" | "Cancelled";
export type EntryState = "Pending" | "Admitted" | "Flagged" | "Refunded";

/** All USDG quantities crossing an API boundary are decimal strings of 6-decimal base units. */
export interface MachineQuote {
  machineId: string;
  chainId: FoilChainId;
  mode: IntegrationMode;
  name: string;
  category: "Pokémon TCG" | "One Piece" | "Sports" | "Other trading cards";
  priceMicros: string;
  expectedValueMicros: string;
  evLowMicros: string;
  buybackBps: number;
  partnerFeeBps: number;
  odds: { label: string; probabilityBps: number }[];
  adopted: boolean;
  available: boolean;
  quotedAt: string;
  expiresAt: string;
}

export interface RoundSnapshot {
  roundId: string;
  requestCount: number;
  closesAt: string;
  state: "Open" | "Closed" | "Executed" | "Delayed";
  receiptAvailable: boolean;
  canCancel: boolean;
  canSelfExecute: boolean;
}

export interface ProtocolHealth {
  chainId: FoilChainId;
  depositsPaused: boolean;
  newRequestsPaused: boolean;
  conservation: "verified" | "mismatch" | "unavailable";
  asOf: string;
}
