/** Bundles scripts/vercel/entry.ts into a Vercel Build Output (.vercel-build/.vercel/output). */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
// Bundle exactly what bun.lock pins; nothing in the bundle needs install scripts.
const inst = Bun.spawnSync(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (inst.exitCode !== 0) throw new Error("bun install --frozen-lockfile failed");

export const buildDir = join(root, ".vercel-build");
const out = join(buildDir, ".vercel", "output");
const fn = join(out, "functions", "index.func");
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
const r = await Bun.build({ entrypoints: [join(import.meta.dir, "entry.ts")], target: "node", format: "esm", outdir: fn, naming: "index.mjs" });
if (!r.success) throw new AggregateError(r.logs, "bundle failed");
writeFileSync(join(fn, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 300 }));
writeFileSync(join(out, "config.json"), JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }));
console.log(`built ${fn}`);
