import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  // Monorepo: Turbopack resolves from the workspace root; workspace packages ship TS source.
  turbopack: { root: path.join(process.cwd(), "../..") },
  transpilePackages: ["@foil/protocol", "@foil/client", "@foil/ohttp", "@foil/guard"],
  // Drop the `X-Powered-By: Next.js` response header.
  poweredByHeader: false,

  compiler: {
    // Strip `console.*` from production bundles, keeping error/warn for
    // monitoring. Left on in dev so logs stay available.
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },

  images: {
    unoptimized: true,
    // WebP only: sharp's AVIF encoder hung (minutes, never finished) on some of
    // the large card PNGs from Figma, so those images never loaded.
    formats: ["image/webp"],
    // Breakpoints `next/image` uses to build `srcset`. `deviceSizes` covers
    // full-width images (aligned with the adaptive-grid breakpoints + retina);
    // `imageSizes` covers smaller, fixed-width images and icons.
    deviceSizes: [360, 640, 768, 1024, 1280, 1440, 1920, 2560],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // The stylesheet inline in the HTML: no render-blocking CSS request before
  // first paint (Fix Catalog: `experimental.inlineCss`).
  experimental: {
    inlineCss: true,
  },

  // React Compiler (automatic memoisation) is an opt-in performance win.
  // It requires the `babel-plugin-react-compiler` dev dependency and routes
  // the build through Babel — enable once installed:
  // reactCompiler: true,
};

export default nextConfig;
