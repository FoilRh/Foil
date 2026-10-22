// Compile every circuit in src/ (except lib) to build/<name>/{<name>.r1cs, <name>_js/<name>.wasm}.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CIRCUITS = ["joinsplit", "tin_request", "ppoi"] as const;
const root = join(import.meta.dir, "..");

export function compile(name: string) {
  const out = join(root, "build", name);
  mkdirSync(out, { recursive: true });
  const p = Bun.spawnSync(["circom", join(root, "src", `${name}.circom`), "--r1cs", "--wasm", "--O2", "-o", out], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = p.stdout.toString() + p.stderr.toString();
  if (p.exitCode !== 0) throw new Error(`circom ${name} failed:\n${text}`);
  const constraints = /non-linear constraints: (\d+)/.exec(text)?.[1];
  return { name, constraints: Number(constraints), wasm: join(out, `${name}_js`, `${name}.wasm`), r1cs: join(out, `${name}.r1cs`) };
}

/** Run snarkjs; returns its output, throws with it on failure. */
export function snarkjs(...args: string[]): string {
  const p = Bun.spawnSync(["bunx", "snarkjs", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString() + p.stderr.toString();
  if (p.exitCode !== 0 || /\[ERROR\]|ZKey Not Ok/i.test(out)) throw new Error(`snarkjs ${args[0]} ${args[1]} failed:\n${out}`);
  return out;
}

export const contractName = (name: string) => name.split("_").map((s) => s[0]!.toUpperCase() + s.slice(1)).join("") + "Verifier";

/**
 * From a final zkey: the verification key, the Solidity verifier in contracts/src/verifiers,
 * and the prover artifacts in build/artifacts (what the client loads).
 */
export function exportKeys(name: string, zkey: string, wasm: string) {
  const dir = join(root, "build", name);
  const verifiers = join(root, "..", "contracts", "src", "verifiers");
  mkdirSync(verifiers, { recursive: true });
  mkdirSync(join(root, "build", "artifacts"), { recursive: true });
  snarkjs("zkey", "export", "verificationkey", zkey, join(dir, `${name}.vkey.json`));
  const sol = join(verifiers, `${contractName(name)}.sol`);
  snarkjs("zkey", "export", "solidityverifier", zkey, sol);
  writeFileSync(sol, readFileSync(sol, "utf8").replace("contract Groth16Verifier", `contract ${contractName(name)}`)
    .replace(/pragma solidity [^;]+;/, "pragma solidity 0.8.26;"));
  copyFileSync(wasm, join(root, "build", "artifacts", `${name}.wasm`));
  copyFileSync(zkey, join(root, "build", "artifacts", `${name}.zkey`));
}

if (import.meta.main) {
  const only = process.argv[2];
  for (const name of CIRCUITS.filter((c) => !only || c === only)) {
    const r = compile(name);
    console.log(`${r.name}: ${r.constraints} non-linear constraints`);
  }
}
