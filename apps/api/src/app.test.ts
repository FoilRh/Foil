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
async function call(app: ReturnType<typeof createApp>, key: GatewayKey, path: string, body: unknown, method = "POST") {
  const c = await encapsulateRequest(key, encodeRequest({
    method, scheme: "https", authority: "foil.internal", path, headers: method === "GET" ? [] : [["content-type", "application/json"]],
    body: method === "GET" ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
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

test("bridge: only a Foil-quoted Relay deposit from the tin is broadcast", async () => {
  const { encodeFunctionData } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { ERC20_ABI, RELAY_DEPOSITORY_ABI } = await import("@foil/guard");
  const { RELAY } = await import("@foil/protocol");
  const tin = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
  const ID = `0x${"ab".repeat(32)}` as const; // the depository's deposit id
  const REQ = `0x${"ef".repeat(32)}`; // Relay's request id (status)
  const RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const depositData = (depositor: string, id: `0x${string}` = ID) =>
    encodeFunctionData({ abi: RELAY_DEPOSITORY_ABI, functionName: "depositErc20", args: [depositor as `0x${string}`, USDG, 25_040_000n, id] });
  let depositor: string = tin.address;
  const sent: string[] = [];
  const key = await generateGatewayKey(1);
  const app = createApp(key, ctx({
    chainId: 4663, usdg: USDG, vault: POOL, cardNft: POOL,
    chain: {
      readContract: async () => 50_000_000n,
      request: async ({ params }: { params: string[] }) => { sent.push(params[0]!); return `0x${"99".repeat(32)}`; },
    } as never,
    bridge: {
      secret: new Uint8Array(32).fill(7),
      relay: async () => ({
        steps: [
          { id: "approve", items: [{ data: { to: USDG, data: "0x095ea7b3", chainId: 4663, value: "0" } }] },
          { id: "deposit", requestId: REQ, items: [{ data: { to: RELAY.depository, data: depositData(depositor), chainId: 4663, value: "0" } }] },
        ],
        details: { recipient: RECIPIENT, currencyOut: { amount: "25000000" } },
      }),
    },
  }));
  const quote = async () => JSON.parse((await call(app, key, "/trpc/bridge.quote", { tin: tin.address, recipient: RECIPIENT, amountOut: "25000000" })).text);
  const q = (await quote()).result.data;
  expect(q.amountIn).toBe("25040000");
  expect(q.requestId).toBe(REQ);
  expect(q.depositId).toBe(ID);

  const sign = (to: `0x${string}`, data: `0x${string}`, nonce: number) =>
    tin.signTransaction({ type: "eip1559", chainId: 4663, nonce, to, data, value: 0n, gas: 100_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n });
  const ticket = { depositId: q.depositId, amountIn: q.amountIn, ticket: q.ticket };
  const broadcast = async (raw: string, bridge?: unknown) => JSON.parse((await call(app, key, "/trpc/broadcast", { raw, ...(bridge ? { bridge } : {}) })).text);

  // The quoted approval and deposit go out.
  expect((await broadcast(await sign(q.approve.to, q.approve.data, 0), ticket)).result.data.hash).toBeDefined();
  expect((await broadcast(await sign(q.deposit.to, q.deposit.data, 1), ticket)).result.data.hash).toBeDefined();
  expect(sent.length).toBe(2);

  // A forged ticket, a ticket for another tin, or no ticket at all: refused.
  expect((await broadcast(await sign(q.deposit.to, q.deposit.data, 2), { ...ticket, ticket: "00".repeat(32) })).error.message).toContain("not a Foil bridge quote");
  const other = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const otherRaw = await other.signTransaction({ type: "eip1559", chainId: 4663, nonce: 0, to: q.deposit.to, data: q.deposit.data, value: 0n, gas: 100_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n });
  expect((await broadcast(otherRaw, ticket)).error.message).toContain("not a Foil bridge quote");
  expect((await broadcast(await sign(q.approve.to, encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [RELAY.depository, 25_040_000n] }), 3))).error.message).toContain("unknown spender");
  // The ticket covers one quote: a deposit under another request id is refused.
  expect((await broadcast(await sign(q.deposit.to, depositData(tin.address, `0x${"cd".repeat(32)}`), 4), ticket)).error.message).toContain("another quote");
  expect(sent.length).toBe(2);

  // A Relay quote that pays out from someone else's deposit is never offered.
  depositor = other.address;
  expect((await quote()).error.message).toContain("unexpected bridge route");
});

test("rpc: gas estimates for Relay's depository pass only while the bridge is open", async () => {
  const { RELAY } = await import("@foil/protocol");
  const key = await generateGatewayKey(1);
  const est = { method: "eth_estimateGas", params: [{ from: POOL, to: RELAY.depository, data: "0xe8017952" }] };
  const ok = { request: async () => "0x5208" } as never;
  const open = createApp(key, ctx({ chain: ok, bridge: { secret: new Uint8Array(32), relay: async () => ({}) } }));
  expect(JSON.parse((await call(open, key, "/trpc/rpc", est)).text).result.data).toBe("0x5208");
  const closed = createApp(key, ctx({ chain: ok }));
  expect(JSON.parse((await call(closed, key, "/trpc/rpc", est)).text).error.message).toContain("not allowed");
});

test("rooms: a Collector Crypt card pulled on Solana can be posted; one the tin did not pull cannot", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const { bytesToHex } = await import("viem");
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const { handleName, postMessage, seasonOf } = await import("@foil/protocol");
  const tin = privateKeyToAccount(`0x${"33".repeat(32)}`);
  const sk = ed25519.utils.randomSecretKey();
  const handlePub = bytesToHex(ed25519.getPublicKey(sk));
  const handle = handleName(handlePub);
  const season = seasonOf();
  const PULLED = "sol:HVeJ7A7fwseBG7uhKNUmhWYHm381sGC7UhaUo4JXJUMH";
  const meta = { name: "2025 #065 Ivysaur PSA 9 Japanese", grade: "MINT 9", image: null, insuredValue: "22000000" };
  const key = await generateGatewayKey(1);
  const snapshot = { asOf: "2026-11-05T00:00:00.000Z", pulls: [{ tin: tin.address.toLowerCase(), id: PULLED, held: false, ...meta }] };
  const app = createApp(key, ctx({ solanaCards: {
    pulls: async () => [],
    pullsOf: async (t) => (t.toLowerCase() === tin.address.toLowerCase() ? [{ id: PULLED, held: false, meta }] : []),
    snapshot: async () => snapshot,
  } }));
  const post = async (tokenId: string) => {
    const msg = postMessage(season, handle, tokenId, tin.address);
    const body = { season, handle, handlePub, tokenId, tin: tin.address, sigTin: await tin.signMessage({ message: msg }), sigHandle: bytesToHex(ed25519.sign(new TextEncoder().encode(msg), sk)) };
    return JSON.parse((await call(app, key, "/trpc/rooms.post", body)).text);
  };
  expect((await post("sol:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).error.message).toContain("did not pull");
  const ok = (await post(PULLED)).result.data;
  expect(ok).toMatchObject({ tokenId: PULLED, name: meta.name, insuredValue: "22000000" });
  expect((await post(PULLED)).error.message).toContain("already posted");
  // Clients download everyone's pulls and match their tins locally; no per-tin lookup exists.
  const snap = JSON.parse((await call(app, key, "/trpc/rooms.pullsSnapshot", undefined, "GET")).text).result.data;
  expect(snap).toEqual(snapshot);
  expect((await call(app, key, "/trpc/rooms.pulls", { tin: tin.address })).status).toBe(404);
});

test("gateway: with a relay token set, sealed requests must come through the relay", async () => {
  const key = await generateGatewayKey(1);
  const app = createApp(key, ctx(), { relayToken: "r".repeat(40) });
  const sealed = async (relayHeader?: string) => {
    const c = await encapsulateRequest(key, encodeRequest({ method: "GET", scheme: "https", authority: "foil.internal", path: "/trpc/rooms.list", headers: [], body: new Uint8Array() }));
    return app.fetch(new Request("http://api/gateway", {
      method: "POST", body: c.request as Uint8Array<ArrayBuffer>,
      headers: { "content-type": "message/ohttp-req", ...(relayHeader ? { "x-foil-relay": relayHeader } : {}) },
    }));
  };
  expect((await sealed()).status).toBe(403);
  expect((await sealed("wrong".repeat(8))).status).toBe(403);
  expect((await sealed("r".repeat(40))).status).toBe(200);
});
