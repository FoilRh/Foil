import { UNIT, bpsCeil } from "./money";

/** Tin sizes in whole USDG (Build §3.2). */
export const TIN_DENOMINATIONS = [10, 25, 50, 100, 250, 500, 1000] as const;
export type TinSize = (typeof TIN_DENOMINATIONS)[number];
export const TIN_SIZES_MICROS = TIN_DENOMINATIONS.map((d) => BigInt(d) * UNIT);

export const ROUND_RULES = {
  cadenceMinutes: 10,
  minimumRequests: 8,
  maxWaitMinutes: 30,
  fallbackAfterCloseMinutes: 60,
} as const;

/** Build §3.1 / §3.3 / §6. Basis points and flat fees in base units. */
export const FEES = {
  depositBps: 15n,
  withdrawBps: 25n,
  tinFundingBps: 15n,
  tinFundingFlat: 200_000n, // $0.20
  relayerFloor: 250_000n, // $0.25 per spend
  relayerMax: 5_000_000n, // StashPool.MAX_RELAYER_FEE
  minDeposit: 1_000_000n, // StashPool.MIN_DEPOSIT
  sendBackOverBps: 25n, // above the tin's funded amount
  giftFlat: 500_000n, // $0.50
} as const;

/** Deposit fee: 0.15% rounded up, in USDG base units. */
export const depositFee = (amount: bigint) => bpsCeil(amount, FEES.depositBps);
/** Withdraw fee: 0.25% rounded up, in USDG base units. */
export const withdrawFee = (amount: bigint) => bpsCeil(amount, FEES.withdrawBps);
/** Tin funding fee excluding gas, which is quoted live (ethPerTin converted to USDG). */
export const tinFundingFee = (size: bigint) => bpsCeil(size, FEES.tinFundingBps) + FEES.tinFundingFlat;
/** Send-back fee: free up to what the tin was funded with, 0.25% on the excess. */
export const sendBackFee = (amount: bigint, funded: bigint) =>
  amount > funded ? bpsCeil(amount - funded, FEES.sendBackOverBps) : 0n;

export const SEND_BACK = { minMicros: UNIT, maxPerTin: 10 } as const;

export const LIMIT_DEFAULTS = {
  dailyMicros: 250n * UNIT,
  weeklyMicros: 1000n * UNIT,
  raiseDelayMs: 24 * 3600_000,
  coolOffMs: 7 * 24 * 3600_000,
} as const;

/**
 * Mirrors StashPool.canClose (Build §3.2): within 2 minutes after a 10-minute
 * boundary (at or after the first one following the round's first request) with
 * ≥ 8 requests, or 30 minutes after the first request regardless.
 */
export const CLOSE_WINDOW_SECONDS = 120;
/** True when a round with `requests` requests, first made at `firstRequestAt`, may close at `now` (rule above). */
export function shouldCloseRound(firstRequestAt: Date, now: Date, requests: number): boolean {
  if (requests === 0) return false;
  const opened = Math.floor(firstRequestAt.getTime() / 1000);
  const t = Math.floor(now.getTime() / 1000);
  const cadence = ROUND_RULES.cadenceMinutes * 60;
  if (t >= opened + ROUND_RULES.maxWaitMinutes * 60) return true;
  const firstBoundary = (Math.floor(opened / cadence) + 1) * cadence;
  return requests >= ROUND_RULES.minimumRequests && t >= firstBoundary && t % cadence < CLOSE_WINDOW_SECONDS;
}
