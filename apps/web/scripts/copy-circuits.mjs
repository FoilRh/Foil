// Copies proving artifacts (circuits/build/artifacts) into public/circuits for the
// browser prover. They must match the deployed verifiers: dev keys for local work, ceremony
// keys for testnet/mainnet (circuits/CEREMONY.md). Files are content-addressed
// (<name>.<sha256:16>.<ext>) and listed in circuits.json, so a browser that cached old keys
// never proves with them after the keys change.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const from = join(import.meta.dirname, "..", "..", "..", "circuits", "build", "artifacts");
const to = join(import.meta.dirname, "..", "public", "circuits");
if (!existsSync(from)) {
  console.warn("copy-circuits: no artifacts (run `bun run setup:dev` in circuits/); live proving disabled");
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const manifest = {};
for (const f of readdirSync(from)) {
  const m = /^(joinsplit|tin_request)\.(wasm|zkey)$/.exec(f);
  if (!m) continue;
  const hash = createHash("sha256").update(readFileSync(join(from, f))).digest("hex").slice(0, 16);
  const name = `${m[1]}.${hash}.${m[2]}`;
  copyFileSync(join(from, f), join(to, name));
  manifest[f] = name;
}
writeFileSync(join(to, "circuits.json"), JSON.stringify(manifest));
console.log("copy-circuits: done", manifest);
