/**
 * Groth16 phase-2 ceremony for every circuit (Build §3.4, §14 step 1; see CEREMONY.md).
 * State lives in one directory (CEREMONY_DIR, default circuits/ceremony) that the coordinator
 * passes from contributor to contributor:
 *   bun scripts/ceremony.ts init <ptau>           coordinator: compile, check the public ptau,
 *                                                 write <circuit>_0000.zkey
 *   bun scripts/ceremony.ts contribute "<name>"   each contributor, on their own machine: one
 *                                                 contribution to every circuit (fresh entropy,
 *                                                 never stored)
 *   bun scripts/ceremony.ts verify                anyone: the latest zkeys against r1cs + ptau
 *   bun scripts/ceremony.ts finalize <beaconHex>  coordinator: public random beacon, verify,
 *                                                 export Solidity verifiers + prover artifacts
 * Every step appends to transcript.md: file hashes and snarkjs's contribution lists. Publish it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CIRCUITS, compile, contractName, exportKeys, snarkjs } from "./build";

const root = join(import.meta.dir, "..");
const dir = resolve(process.env.CEREMONY_DIR ?? join(root, "ceremony"));
const transcript = join(dir, "transcript.md");
const r1csOf = (c: string) => join(root, "build", c, `${c}.r1cs`);
const wasmOf = (c: string) => join(root, "build", c, `${c}_js`, `${c}.wasm`);
const sha256 = (f: string) => new Bun.CryptoHasher("sha256").update(readFileSync(f)).digest("hex");
const log = (s: string) => {
  appendFileSync(transcript, `${s}\n`);
  console.log(s);
};
const ptauPath = () => {
  const p = join(dir, "ptau.txt");
  if (!existsSync(p)) throw new Error(`no ceremony in ${dir}: run init first`);
  return readFileSync(p, "utf8").trim();
};
/** Latest zkey index for a circuit (0000, 0001, …). */
function latest(c: string): number {
  const ns = readdirSync(dir).flatMap((f) => {
    // <circuit>_NNNN.zkey, matched without building a regex from the name.
    const n = f.startsWith(`${c}_`) && f.endsWith(".zkey") ? f.slice(c.length + 1, -".zkey".length) : "";
    return /^\d{4}$/.test(n) ? [Number(n)] : [];
  });
  if (!ns.length) throw new Error(`no ${c} zkey in ${dir}`);
  return Math.max(...ns);
}
const zkey = (c: string, n: number) => join(dir, `${c}_${String(n).padStart(4, "0")}.zkey`);
const contributions = (out: string) => out.split("\n").filter((l) => /contribution|Hash|beacon/i.test(l)).map((l) => `    ${l.replace(/^\[INFO\]\s+snarkJS:\s*/, "").trim()}`).join("\n");

const [cmd, arg] = process.argv.slice(2);
if (cmd === "init") {
  if (!arg) throw new Error("usage: init <ptau>");
  mkdirSync(dir, { recursive: true });
  const ptau = resolve(arg);
  writeFileSync(join(dir, "ptau.txt"), ptau);
  writeFileSync(transcript, `# Foil phase-2 ceremony transcript\n\nStarted ${new Date().toISOString()}.\n\n`);
  snarkjs("powersoftau", "verify", ptau);
  log(`- Powers of Tau: \`${ptau.split(/[\\/]/).pop()}\` sha256 \`${sha256(ptau)}\` (verified)`);
  for (const c of CIRCUITS) {
    const { r1cs, constraints } = compile(c);
    snarkjs("groth16", "setup", r1cs, ptau, zkey(c, 0));
    log(`- ${c}: ${constraints} constraints, r1cs sha256 \`${sha256(r1cs)}\`, ${c}_0000.zkey sha256 \`${sha256(zkey(c, 0))}\``);
  }
} else if (cmd === "contribute") {
  if (!arg) throw new Error('usage: contribute "<your name>"');
  log(`\n## Contribution: ${arg} (${new Date().toISOString()})`);
  for (const c of CIRCUITS) {
    const n = latest(c);
    const entropy = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString("hex"); // used once, never written
    const out = snarkjs("zkey", "contribute", zkey(c, n), zkey(c, n + 1), `--name=${arg}`, `-e=${entropy}`);
    log(`- ${c}_${String(n + 1).padStart(4, "0")}.zkey sha256 \`${sha256(zkey(c, n + 1))}\`\n${contributions(out)}`);
  }
} else if (cmd === "verify") {
  const ptau = ptauPath();
  for (const c of CIRCUITS) {
    snarkjs("zkey", "verify", r1csOf(c), ptau, zkey(c, latest(c)));
    console.log(`${c}_${String(latest(c)).padStart(4, "0")}.zkey: ok`);
  }
} else if (cmd === "finalize") {
  if (!arg || !/^(0x)?[0-9a-fA-F]{64}$/.test(arg)) throw new Error("usage: finalize <beacon: 32-byte hex, e.g. a block hash announced in advance>");
  const ptau = ptauPath();
  const beacon = arg.replace(/^0x/, "");
  log(`\n## Finalize (${new Date().toISOString()})\n- Beacon: \`${beacon}\`, 2^10 iterations`);
  for (const c of CIRCUITS) {
    const n = latest(c);
    if (n < 3) throw new Error(`${c} has ${n} contributions; the ceremony needs at least 3`);
    const final = join(dir, `${c}_final.zkey`);
    snarkjs("zkey", "beacon", zkey(c, n), final, beacon, "10", "-n=final beacon");
    const out = snarkjs("zkey", "verify", r1csOf(c), ptau, final);
    exportKeys(c, final, wasmOf(c));
    log(`- ${c}_final.zkey sha256 \`${sha256(final)}\` → ${contractName(c)}.sol\n${contributions(out)}`);
  }
  log("\nRedeploy the verifiers (contracts/script/Deploy.s.sol) and rebuild the web app with these artifacts.");
} else {
  throw new Error("usage: ceremony.ts init <ptau> | contribute <name> | verify | finalize <beaconHex>");
}
