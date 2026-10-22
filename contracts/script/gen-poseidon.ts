// Writes script/poseidon.json from poseidon-solidity's pre-built creation bytecode.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import p from "poseidon-solidity";
const { PoseidonT3, PoseidonT4 } = p as Record<string, { bytecode: string }>;
writeFileSync(join(import.meta.dir, "poseidon.json"), JSON.stringify({ t3: PoseidonT3!.bytecode, t4: PoseidonT4!.bytecode }) + "\n");
