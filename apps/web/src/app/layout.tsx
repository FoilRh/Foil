import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import {
  generateMetadata,
  generateViewport,
} from "@/utils/seo/generate-page-metadata";
import { getSiteStructuredData } from "@/utils/seo/structured-data";

import { LazyCookie } from "@/components/common/Cookie";
import { CONSENT_FLAG_SCRIPT } from "@/components/common/Cookie/consent-flag";
import { originSyncScript } from "@/components/common/origin-sync";
import { siteConfig } from "@/lib/site";
import { AdaptiveGrid } from "@/components/common/grid";
import { ReducedMotion } from "@/components/common/reduced-motion";
import { ScrollLayout } from "@/layouts/scroll-layout";

import {DashboardTransition} from "@/components/foil/dashboard-transition";
import {DashboardImagePrefetch} from "@/components/foil/dashboard-image-prefetch";
import "@/app/globals.css";

// Fonts from the Figma frame (Concept 16): Sora for body copy, Barlow
// Condensed for display/UI, Sedgwick Ave Display for the hand-written marks.
// Self-hosted Latin subsets (Google Fonts' own `latin` files), and only the
// faces the CSS uses: Barlow is set in SemiBold upright (`type-caps`) and
// Black Italic (`type-display`) only — `next/font/google` with weight × style
// preloaded all four combinations, two of them never drawn.
const sora = localFont({
  variable: "--font-sora",
  src: [{ path: "../fonts/sora-400.woff2", weight: "400", style: "normal" }],
  display: "swap",
});

const barlowCondensed = localFont({
  variable: "--font-barlow-condensed",
  src: [
    { path: "../fonts/barlow-condensed-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/barlow-condensed-900-italic.woff2", weight: "900", style: "italic" },
  ],
  display: "swap",
});

const sedgwick = localFont({
  variable: "--font-sedgwick",
  src: [{ path: "../fonts/sedgwick-ave-display-400.woff2", weight: "400", style: "normal" }],
  display: "swap",
});

export const metadata: Metadata = generateMetadata();
export const viewport: Viewport = generateViewport();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `data-consent` is set on <html> by CONSENT_FLAG_SCRIPT before hydration.
    <html suppressHydrationWarning lang="en">
      <body
        className={`${sora.variable} ${barlowCondensed.variable} ${sedgwick.variable} font-sans`}
      >
        {/* Before anything is parsed: marks a returning visitor's choice so the
            server-rendered consent banner is hidden before its first paint. */}
        <script dangerouslySetInnerHTML={{ __html: CONSENT_FLAG_SCRIPT }} />
        {/* Canonical + share URLs follow the origin serving the page (D-035). */}
        <script dangerouslySetInnerHTML={{ __html: originSyncScript(siteConfig.url) }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(getSiteStructuredData()),
          }}
        />
        <ScrollLayout>
          <AdaptiveGrid coef={1} />
          <ReducedMotion />
          <DashboardImagePrefetch />
          <DashboardTransition />
          <LazyCookie />
          {children}
        </ScrollLayout>
      </body>
    </html>
  );
}
