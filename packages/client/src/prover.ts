/// <reference path="./vendor.d.ts" />
/** Groth16 proving on the device (Build §2: no remote prover in v1). */
import * as snarkjs from "snarkjs";

export interface SolidityProof {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
}

type Signals = Record<string, unknown>;
const toStrings = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(toStrings) : typeof v === "bigint" ? v.toString() : v;

/** wasm/zkey: file paths (Node/Bun) or bytes (browser, fetched through the transport). */
export async function prove(input: Signals, wasm: string | Uint8Array, zkey: string | Uint8Array) {
  const json = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, toStrings(v)]));
  // snarkjs worker threads crash under Bun; browsers keep the multi-threaded prover.
  const singleThread = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(json, wasm, zkey, undefined, undefined, { singleThread });
  const p = proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
  const B = (i: number, j: number) => BigInt(p.pi_b[i]![j]!);
  // The EVM pairing precompile takes G2 coordinates as (imaginary, real).
  const solidity: SolidityProof = {
    a: [BigInt(p.pi_a[0]!), BigInt(p.pi_a[1]!)],
    b: [[B(0, 1), B(0, 0)], [B(1, 1), B(1, 0)]],
    c: [BigInt(p.pi_c[0]!), BigInt(p.pi_c[1]!)],
  };
  return { proof: solidity, publicSignals: (publicSignals as string[]).map(BigInt) };
}
