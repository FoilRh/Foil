// DEV-ONLY trusted setup: a local single-party Powers of Tau and one phase-2
// contribution per circuit. Never use these keys on mainnet; see CEREMONY.md.
// Outputs:
//   build/<name>/<name>.zkey, <name>.vkey.json
//   contracts/src/verifiers/<Name>Verifier.sol
//   build/artifacts/<name>.{wasm,zkey}  (what the client prover loads)
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CIRCUITS, compile, contractName, exportKeys, snarkjs } from "./build";

const root = join(import.meta.dir, "..");
const build = join(root, "build");
const POWER = 15;
const entropy = () => crypto.randomUUID() + crypto.randomUUID();

mkdirSync(build, { recursive: true });

const ptau = join(build, `dev_${POWER}.ptau`);
if (!existsSync(ptau)) {
  console.log(`powers of tau 2^${POWER} (dev, one-time, a few minutes)…`);
  snarkjs("powersoftau", "new", "bn128", String(POWER), join(build, "pot0.ptau"));
  snarkjs("powersoftau", "contribute", join(build, "pot0.ptau"), join(build, "pot1.ptau"), "--name=foil-dev", `-e=${entropy()}`);
  snarkjs("powersoftau", "prepare", "phase2", join(build, "pot1.ptau"), ptau);
}

for (const name of CIRCUITS) {
  const { r1cs, wasm, constraints } = compile(name);
  const dir = join(build, name);
  const z0 = join(dir, `${name}_0.zkey`);
  const zkey = join(dir, `${name}.zkey`);
  snarkjs("groth16", "setup", r1cs, ptau, z0);
  snarkjs("zkey", "contribute", z0, zkey, "--name=foil-dev", `-e=${entropy()}`);
  exportKeys(name, zkey, wasm);
  console.log(`${name}: ${constraints} constraints → ${contractName(name)}.sol`);
}
