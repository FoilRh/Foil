/**
 * Builds the unpacked extension into apps/extension/dist (load it at chrome://extensions,
 * "Load unpacked"). FOIL_APP_ORIGINS (comma-separated) lists the Foil web origins allowed
 * to connect; default http://localhost:3000. TUNNEL_PROXY routes the pack domains through
 * services/tunnel-relay (e.g. "HTTPS tunnel.foil.example:443").
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_ORIGINS } from "../src/core";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const r = await Bun.build({
  entrypoints: ["inpage", "content", "background", "confirm"].map((f) => join(root, "src", `${f}.ts`)),
  outdir: dist,
  target: "browser",
  format: "esm",
  minify: true,
  define: { TUNNEL_PROXY: JSON.stringify(process.env.TUNNEL_PROXY ?? "") },
});
if (!r.success) throw new AggregateError(r.logs, "extension build failed");

const appOrigins = (process.env.FOIL_APP_ORIGINS ?? "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean);
const packMatches = PACK_ORIGINS.map((o) => `${o}/*`);
writeFileSync(join(dist, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "Foil",
  version: "0.1.0",
  description: "A fresh tin for every rip: Foil's guarded wallet for pack sites.",
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [
    { matches: packMatches, js: ["inpage.js"], run_at: "document_start", world: "MAIN" },
    { matches: packMatches, js: ["content.js"], run_at: "document_start" },
  ],
  permissions: ["storage", "browsingData", "tabs", "proxy"],
  host_permissions: packMatches,
  externally_connectable: { matches: appOrigins.map((o) => `${o}/*`) },
}, null, 2));
cpSync(join(root, "public", "confirm.html"), join(dist, "confirm.html"));
console.log(`extension built → ${dist} (app origins: ${appOrigins.join(", ")})`);
