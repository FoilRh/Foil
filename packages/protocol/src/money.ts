import { z } from "zod";

/** USDG amounts are bigint base units (6 decimals). Across APIs they are decimal strings. */
export const UNIT = 1_000_000n;

export const Micros = z.string().regex(/^\d+$/, "base-unit integer string");

/** "25" | "25.5" | "0.000001" → base units. Rejects more than 6 decimals and negatives. */
export function parseUsdg(value: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid USDG amount: ${value}`);
  return BigInt(m[1]!) * UNIT + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** base units → "25.5" (trailing zeros trimmed). */
export function formatUsdg(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const frac = (abs % UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / UNIT}${frac ? `.${frac}` : ""}`;
}

/** Fee in basis points, rounded up so the pool never undercharges. Matches StashPool._bps. */
export const bpsCeil = (amount: bigint, bps: bigint) => (amount * bps + 9_999n) / 10_000n;
