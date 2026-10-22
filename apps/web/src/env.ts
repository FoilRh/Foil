/**
 * Validated environment variables.
 *
 * `publicEnv` holds `NEXT_PUBLIC_*` values — inlined into the client bundle,
 * safe in the browser. `getServerEnv()` holds server-only values (secrets) —
 * never read it from client code; on the client those values are `undefined`.
 *
 * A missing/invalid variable fails fast with a clear zod error rather than
 * surfacing as a confusing runtime bug later.
 */

import { z } from "zod";

/**
 * Treat an empty env var as unset.
 *
 * `cp .env.example .env` leaves declared-but-blank keys (`CONTACT_ENDPOINT=`),
 * which reach us as `""` — and `""` is not `undefined`, so an `.optional()`
 * schema would reject it as "Invalid URL". Without this, the documented setup
 * flow would break every optional variable the moment someone copied the
 * example file.
 */
const optionalUrl = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());

const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: optionalUrl(),
  /** Foil's OHTTP relay. Unset: the dashboard stays in local example mode. */
  NEXT_PUBLIC_OHTTP_RELAY_URL: optionalUrl(),
  /** Pinned gateway key config (hex, from the API's GET /ohttp-keys minus its 2-byte length). */
  NEXT_PUBLIC_OHTTP_KEY_CONFIG: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[0-9a-f]+$/).optional()),
  /** Expected chain: 4663 (RHC mainnet, default) or 46630 (RHC testnet). */
  NEXT_PUBLIC_CHAIN_ID: z.preprocess((v) => (v === "" || v === undefined ? "4663" : v), z.coerce.number().refine((n) => n === 4663 || n === 46630)),
  /** Chrome ID of the Foil extension (browser mode). Unset: ripping stays unavailable. */
  NEXT_PUBLIC_FOIL_EXTENSION_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[a-p]{32}$/).optional()),
});

const serverSchema = z.object({
  /**
   * Vercel's production domain (a system variable, set at build time). The
   * site's origin falls back to it when `NEXT_PUBLIC_SITE_URL` is unset (D-019).
   */
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  /** Optional upstream the contact endpoint forwards leads to (CRM / webhook). */
  CONTACT_ENDPOINT: optionalUrl(),
});

/** Public env — safe to read anywhere (server or client). */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_OHTTP_RELAY_URL: process.env.NEXT_PUBLIC_OHTTP_RELAY_URL,
  NEXT_PUBLIC_OHTTP_KEY_CONFIG: process.env.NEXT_PUBLIC_OHTTP_KEY_CONFIG,
  NEXT_PUBLIC_FOIL_EXTENSION_ID: process.env.NEXT_PUBLIC_FOIL_EXTENSION_ID,
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
});

let cachedServerEnv: z.infer<typeof serverSchema> | undefined;

/**
 * Server-only env. Call from route handlers / server code only — parsed
 * lazily so the client bundle never evaluates it.
 */
export function getServerEnv() {
  cachedServerEnv ??= serverSchema.parse({
    CONTACT_ENDPOINT: process.env.CONTACT_ENDPOINT || undefined,
    VERCEL_PROJECT_PRODUCTION_URL:
      process.env.VERCEL_PROJECT_PRODUCTION_URL || undefined,
  });
  return cachedServerEnv;
}
