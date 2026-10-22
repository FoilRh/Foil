import { afterAll, expect, test } from "bun:test";
import { fetchStatic, loadCircuit } from "./static";

// Minimal Cache Storage + fetch stand-ins.
const store = new Map<string, Response>();
const cache = {
  match: async (p: string) => store.get(p)?.clone(),
  put: async (p: string, r: Response) => void store.set(p, r),
  keys: async () => [...store.keys()].map((p) => new Request(`https://foil.test${p}`)),
  delete: async (r: Request) => store.delete(new URL(r.url).pathname),
};
const realFetch = globalThis.fetch;
const g = globalThis as unknown as { caches?: unknown; fetch: typeof fetch };
g.caches = { open: async () => cache };
let manifest: Record<string, string> = {};
g.fetch = (async (input: string | URL | Request) => {
  const p = String(input);
  if (p === "/circuits/circuits.json") return Response.json(manifest);
  return new Response(new TextEncoder().encode(p));
}) as typeof fetch;
afterAll(() => {
  g.fetch = realFetch;
  delete g.caches;
});

test("new keys replace cached old ones; a circuit's wasm and zkey do not evict each other", async () => {
  manifest = { "tin_request.wasm": "tin_request.w1.wasm", "tin_request.zkey": "tin_request.k1.zkey" };
  await loadCircuit("tin_request");
  await fetchStatic("/circuits/joinsplit.j1.zkey");
  expect([...store.keys()].sort()).toEqual(["/circuits/joinsplit.j1.zkey", "/circuits/tin_request.k1.zkey", "/circuits/tin_request.w1.wasm"]);

  manifest = { "tin_request.wasm": "tin_request.w1.wasm", "tin_request.zkey": "tin_request.k2.zkey" }; // new ceremony key
  const { zkey } = await loadCircuit("tin_request");
  expect(new TextDecoder().decode(zkey)).toBe("/circuits/tin_request.k2.zkey");
  expect([...store.keys()].sort()).toEqual(["/circuits/joinsplit.j1.zkey", "/circuits/tin_request.k2.zkey", "/circuits/tin_request.w1.wasm"]);
});
