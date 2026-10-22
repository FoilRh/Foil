// Gateway hardening: error formatter (audit error-leak-rpc-url) and size caps; per-client rate limits are in services/ohttp-relay (audit missing-rate-limit).
import { expect, test } from "bun:test";
import { decodeResponse, encapsulateRequest, encodeRequest, generateGatewayKey, type GatewayKey } from "@foil/ohttp";
import { MAX_BATCH, MAX_REQUEST_BYTES, createApp } from "./app";
import type { Ctx } from "./router";
import { memoryStores } from "./stores";

const POOL = "0x0000000000000000000000000000000000000001";
const SECRET = "http://rpc.internal/v2/SECRET_PAID_KEY_123";
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  // A viem transport error quotes the URL (with its key) in its message.
  chain: { request: async () => { throw new Error(`HTTP request failed.\n\nURL: ${SECRET}\nRequest body: {}`); } } as never,
  pool: POOL, usdg: POOL, gate: POOL, chainId: 46630, startBlock: 0n,
  internal: async () => { throw Object.assign(new Error("reverted: StandbyActive"), { expose: true }); },
  relayer: { address: POOL, feeFloor: "0" }, stores: memoryStores(), attest: async () => [], ...over,
});

/** One tRPC POST through OHTTP; returns the inner status and JSON. */
async function call(app: ReturnType<typeof createApp>, key: GatewayKey, path: string, body: unknown) {
  const c = await encapsulateRequest(key, encodeRequest({
    method: "POST", scheme: "https", authority: "foil.internal", path, headers: [["content-type", "application/json"]],
    body: new TextEncoder().encode(JSON.stringify(body)),
  }));
  const res = await app.fetch(new Request("http://api/gateway", { method: "POST", headers: { "content-type": "message/ohttp-req" }, body: c.request as Uint8Array<ArrayBuffer> }));
  const inner = decodeResponse(await c.openResponse(new Uint8Array(await res.arrayBuffer())));
  return { status: inner.status, text: new TextDecoder().decode(inner.body) };
}

test("internal errors reach the client as a fixed message; deliberate ones keep theirs", async () => {
  const key = await generateGatewayKey(1);
  const app = createApp(key, ctx());
  const leak = await call(app, key, "/trpc/rpc", { method: "eth_blockNumber", params: [] });
  expect(leak.status).toBe(500);
  expect(leak.text).not.toContain("SECRET_PAID_KEY_123");
  expect(leak.text).not.toContain("rpc.internal");
  expect(leak.text).not.toContain("stack");
  expect(JSON.parse(leak.text).error.message).toBe("internal error");
  expect(JSON.parse((await call(app, key, "/trpc/rpc", { method: "eth_sendRawTransaction" })).text).error.message).toContain("not allowed");
  expect(JSON.parse((await call(app, key, "/trpc/relay", { fn: "admitAfterStandby", args: ["0"] })).text).error.message).toBe("reverted: StandbyActive");
});

test("one caller cannot exhaust a shared budget: the gateway has none", async () => {
  const key = await generateGatewayKey(1);
  const app = createApp(key, ctx());
  const put = () => call(app, key, "/trpc/backup.put", { locator: `0x${"ab".repeat(32)}`, blob: "AAAA" });
  for (let i = 0; i < 100; i++) await put();
  expect((await put()).status).toBe(200);
});

test("oversized backups, bodies and batches are rejected", async () => {
  const key = await generateGatewayKey(1);
  const app = createApp(key, ctx());
  const big = await call(app, key, "/trpc/backup.put", { locator: `0x${"ab".repeat(32)}`, blob: "A".repeat(128 * 1024 + 1) });
  expect(big.status).toBe(400);
  const huge = await app.fetch(new Request("http://api/gateway", { method: "POST", headers: { "content-type": "message/ohttp-req" }, body: new Uint8Array(MAX_REQUEST_BYTES + 1) }));
  expect(huge.status).toBe(413);
  const get = { locator: `0x${"ab".repeat(32)}` };
  const batchOf = (n: number) => call(app, key, `/trpc/${Array(n).fill("backup.get").join(",")}?batch=1`, Object.fromEntries(Array.from({ length: n }, (_, i) => [i, get])));
  const batch = await batchOf(MAX_BATCH + 1);
  expect(batch.status).toBe(400);
  expect(batch.text).toContain("batch too large");
  expect((await batchOf(MAX_BATCH)).status).toBe(200);
});
