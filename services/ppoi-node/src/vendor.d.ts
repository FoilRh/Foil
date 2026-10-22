// Minimal types for the parts of circomlibjs Foil uses.
declare module "circomlibjs" {
  type F = {
    e(v: bigint | number | string): unknown;
    toObject(v: unknown): bigint;
    eq(a: unknown, b: unknown): boolean;
    zero: unknown;
  };
  export type Poseidon = ((inputs: (bigint | unknown)[]) => unknown) & { F: F };
  export function buildPoseidon(): Promise<Poseidon>;
  export type Eddsa = {
    F: F;
    prv2pub(prv: Uint8Array): [unknown, unknown];
    signPoseidon(prv: Uint8Array, msg: unknown): { R8: [unknown, unknown]; S: bigint };
    verifyPoseidon(msg: unknown, sig: { R8: [unknown, unknown]; S: bigint }, A: [unknown, unknown]): boolean;
  };
  export function buildEddsa(): Promise<Eddsa>;
  export type SMT = {
    F: F;
    root: unknown;
    insert(key: unknown, value: unknown): Promise<unknown>;
    delete(key: unknown): Promise<unknown>;
    find(key: unknown): Promise<{
      found: boolean;
      siblings: unknown[];
      foundValue?: unknown;
      notFoundKey?: unknown;
      notFoundValue?: unknown;
      isOld0: boolean;
    }>;
  };
  export function newMemEmptyTrie(): Promise<SMT>;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>, wasm: string | Uint8Array, zkey: string | Uint8Array,
      logger?: unknown, wtnsCalcOptions?: unknown, proverOptions?: { singleThread?: boolean },
    ): Promise<{ proof: unknown; publicSignals: unknown }>;
    verify(vkey: unknown, publicSignals: unknown, proof: unknown): Promise<boolean>;
  };
  export const wtns: {
    calculate(input: Record<string, unknown>, wasm: string | Uint8Array, out: { type: "mem" } | string): Promise<void>;
  };
}
