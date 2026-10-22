/**
 * Site-wide configuration — the single source of truth for SEO.
 *
 * Consumed by the metadata generator, `robots.ts`, `sitemap.ts`, and the
 * JSON-LD structured-data helper.
 */
import { getServerEnv, publicEnv } from "@/env";

/**
 * Vercel's production domain, read at build time — the fallback when a deploy
 * doesn't set `NEXT_PUBLIC_SITE_URL` (none did: the live canonical said
 * localhost). Server-only: every consumer of `siteConfig` renders on the server.
 */
const vercelProduction = getServerEnv().VERCEL_PROJECT_PRODUCTION_URL;

export const siteConfig = {
  name: "FOIL",
  /** Default <title> — the hero line. */
  title: "FOIL — Your cards. Your business.",
  description:
    "Private collecting with a shielded USDG Stash, single-use wallets and keys you control. Explore Foil and organize your collection.",
  /**
   * Public origin, no trailing slash. Drives canonical URLs, OG tags, the
   * sitemap, and JSON-LD. Set `NEXT_PUBLIC_SITE_URL` in production.
   */
  url:
    publicEnv.NEXT_PUBLIC_SITE_URL ??
    (vercelProduction ? `https://${vercelProduction}` : "http://localhost:3000"),
  /** Default Open Graph / Twitter share image (path under `public/`), 1200×630. */
  ogImage: "/open-graph.png",
  ogImageAlt: "FOIL — Your cards. Your business.: private collecting on your terms",
  /** Foil on X (https://x.com/FoilPrivacy): emitted as twitter:site / twitter:creator. */
  twitterHandle: "@FoilPrivacy" as string | undefined,
  author: "FOIL",
  locale: "en_US",
  /** Browser theme-color (address bar / PWA) — the page background, ink-950. */
  themeColor: "#08140f",
} as const;
