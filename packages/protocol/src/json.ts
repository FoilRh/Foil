/**
 * Contract arguments cross the API as JSON: bigints become decimal strings.
 * reviveArgs turns them back using the ABI, so services never guess types.
 */
import type { Abi, AbiParameter } from "viem";

/** Deep-converts bigints to decimal strings so values survive JSON. */
export const toJson = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(toJson)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)])) : v;

function revive(p: AbiParameter, v: unknown): unknown {
  const arr = /^(.*)\[(\d*)\]$/.exec(p.type);
  if (arr) {
    if (!Array.isArray(v)) throw new Error(`${p.name ?? p.type}: expected array`);
    return v.map((x) => revive({ ...p, type: arr[1]! } as AbiParameter, x));
  }
  if (p.type === "tuple") {
    const comps = (p as { components: readonly AbiParameter[] }).components;
    if (Array.isArray(v)) return comps.map((c, i) => revive(c, v[i]));
    if (!v || typeof v !== "object") throw new Error(`${p.name}: expected object`);
    return Object.fromEntries(comps.map((c) => [c.name!, revive(c, (v as Record<string, unknown>)[c.name!])]));
  }
  if (/^u?int\d*$/.test(p.type)) {
    if (typeof v !== "string" && typeof v !== "number") throw new Error(`${p.name}: expected integer string`);
    if (!/^-?\d+$/.test(String(v))) throw new Error(`${p.name}: not an integer`);
    return BigInt(v);
  }
  return v;
}

/** Turns JSON args back into typed contract args using `functionName`'s ABI inputs; throws on any mismatch. */
export function reviveArgs(abi: Abi, functionName: string, args: unknown[]): unknown[] {
  const fn = abi.find((x) => x.type === "function" && x.name === functionName);
  if (!fn || fn.type !== "function") throw new Error(`unknown function ${functionName}`);
  if (args.length !== fn.inputs.length) throw new Error(`${functionName}: expected ${fn.inputs.length} args`);
  return fn.inputs.map((p, i) => revive(p, args[i]));
}
