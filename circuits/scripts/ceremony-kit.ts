/**
 * Builds a self-contained kit for one independent Phase-2 contribution:
 *   CEREMONY_DIR=circuits/ceremony/mainnet bun circuits/scripts/ceremony-kit.ts <out dir>
 * The kit holds the latest zkey of each circuit, a Node script that contributes to all three with
 * fresh entropy (never stored), a checksum list and plain instructions. The contributor runs it on
 * their own computer and sends back the new <circuit>_NNNN.zkey files and contributions.txt; drop
 * those into CEREMONY_DIR, then `ceremony.ts verify` and `ceremony.ts finalize <beacon>`.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CIRCUITS } from "./build";

const dir = resolve(process.env.CEREMONY_DIR ?? join(import.meta.dir, "..", "ceremony"));
const out = resolve(process.argv[2] ?? "ceremony-kit");
mkdirSync(out, { recursive: true });
const sha256 = (f: string) => new Bun.CryptoHasher("sha256").update(readFileSync(f)).digest("hex");

const files: { circuit: string; input: string; output: string }[] = [];
for (const c of CIRCUITS) {
  const ns = readdirSync(dir).flatMap((f) => {
    const n = f.startsWith(`${c}_`) && f.endsWith(".zkey") ? f.slice(c.length + 1, -".zkey".length) : "";
    return /^\d{4}$/.test(n) ? [Number(n)] : [];
  });
  if (!ns.length) throw new Error(`no ${c} zkey in ${dir}`);
  const n = Math.max(...ns);
  const input = `${c}_${String(n).padStart(4, "0")}.zkey`;
  copyFileSync(join(dir, input), join(out, input));
  files.push({ circuit: c, input, output: `${c}_${String(n + 1).padStart(4, "0")}.zkey` });
}
writeFileSync(join(out, "SHA256SUMS.txt"), files.map((f) => `${sha256(join(out, f.input))}  ${f.input}`).join("\n") + "\n");

writeFileSync(join(out, "contribute.mjs"), `// Foil trusted-setup contribution. Run: node contribute.mjs "Your name"
// Needs Node.js 18+. Uses snarkjs 0.7.5 from npm (downloaded on first run). Your random entropy is
// generated here, used once and never written anywhere.
import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
// Names are kept to plain characters so the Windows shell cannot split or reinterpret them.
const name = (process.argv[2] ?? "").replace(/[^A-Za-z0-9 ._@()-]/g, "").trim();
if (!name) { console.error('usage: node contribute.mjs "Your name"'); process.exit(1); }
const win = process.platform === "win32";
const arg = (a) => (win ? \`"\${a}"\` : a); // npx runs through cmd.exe on Windows
const files = ${JSON.stringify(files)};
const sums = Object.fromEntries(readFileSync("SHA256SUMS.txt", "utf8").trim().split("\\n").map((l) => l.split(/\\s+/).reverse()));
const lines = [\`Foil Phase-2 contribution by \${name} at \${new Date().toISOString()}\`];
for (const f of files) {
  const got = createHash("sha256").update(readFileSync(f.input)).digest("hex");
  if (got !== sums[f.input]) { console.error(\`\${f.input}: checksum mismatch, stop and ask for a new kit\`); process.exit(1); }
  if (existsSync(f.output)) { console.error(\`\${f.output} already exists: this kit was used already\`); process.exit(1); }
  console.log(\`contributing to \${f.circuit} (a few minutes)…\`);
  const args = ["-y", "snarkjs@0.7.5", "zkey", "contribute", f.input, f.output, \`--name=\${name}\`, \`-e=\${randomBytes(64).toString("hex")}\`];
  const r = spawnSync("npx", args.map(arg), { encoding: "utf8", shell: win });
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
  const hash = (r.stdout + r.stderr).split("\\n").filter((l) => /Contribution Hash/i.test(l) || /^\\s+[0-9a-f]{8}\\s/.test(l)).join("\\n");
  lines.push(\`\\n\${f.output} sha256 \${createHash("sha256").update(readFileSync(f.output)).digest("hex")}\\n\${hash}\`);
}
writeFileSync("contributions.txt", lines.join("\\n") + "\\n");
console.log("\\nDone. Send back: " + files.map((f) => f.output).join(", ") + " and contributions.txt. Then delete this folder.");
`);

writeFileSync(join(out, "README.txt"), `Foil trusted-setup contribution - instructions for the contributor
=================================================================

Foil's zero-knowledge proofs need a "trusted setup". It is secure as long as at least ONE
contributor generated their randomness honestly and threw it away. You are that independent
contributor: you do not need to trust Foil, and Foil does not need to trust you, as long as you run
this on your own computer and do not keep or share the random data (the script never saves it).

What to do (about 10 minutes):
1. Install Node.js 18 or newer (https://nodejs.org) if you do not have it.
2. Open a terminal in this folder.
3. Run:   node contribute.mjs "Your name or handle"
   It checks the files, then adds your contribution to all three circuits.
4. Send back the three new files (${files.map((f) => f.output).join(", ")}) and contributions.txt,
   for example by a file-sharing link. Keep a copy of contributions.txt: it lists your contribution
   hashes, which will appear in Foil's public ceremony transcript so anyone can check them.
5. Delete this folder.

Do not run it twice and do not run it on a computer you share with the Foil team.
`);

console.log(`kit written to ${out}: ${files.map((f) => f.input).join(", ")} → ${files.map((f) => f.output).join(", ")}`);
