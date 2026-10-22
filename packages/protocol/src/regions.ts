/**
 * Region rules (Build §9): Collector Crypt's restricted destinations plus a configurable
 * list of places where digital pack openings are restricted, enforced by the user's
 * declared region AND the device locale (either one restricts).
 *
 * LAUNCH GATE (Build §16): this list is a placeholder of comprehensively sanctioned
 * jurisdictions plus one loot-box example. Counsel must review it per market, and it
 * must be merged with CC's restricted destinations before any live rip.
 */
export const RESTRICTED_REGIONS: readonly string[] = ["CU", "IR", "KP", "SY", "BE"];

/** "en-US" → "US"; "nl-BE" → "BE"; "fr" → null. */
export function regionFromLocale(locale: string | undefined | null): string | null {
  const m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(locale ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

/** Pack-opening gate: denied with a user-facing reason if no region is declared or either the declared or locale region is restricted. */
export function regionAllowed(declared: string | null | undefined, locale: string | null | undefined, restricted = RESTRICTED_REGIONS) {
  if (!declared) return { allowed: false, reason: "Choose where you are collecting from in Settings." } as const;
  const fromLocale = regionFromLocale(locale);
  const hit = [declared.toUpperCase(), fromLocale].find((r) => r && restricted.includes(r));
  return hit ? ({ allowed: false, reason: "Pack openings are not available in your region." } as const) : ({ allowed: true } as const);
}
