// Per-client rate limit at the relay: one IP over its cap gets 429, others are unaffected.
import { expect, test } from "bun:test";
import { createRelay } from "./relay";

const relay = createRelay({
  gatewayUrl: "http://gateway/gateway", allowedOrigins: [], perIpPerMinute: 2,
  upstream: async () => new Response("ok"),
});
const send = (ip: string) =>
  relay(new Request("http://relay/gateway", { method: "POST", headers: { "content-type": "message/ohttp-req", "fly-client-ip": ip }, body: "x" }));

test("an IP over its per-minute cap gets 429; another IP does not", async () => {
  expect((await send("1.1.1.1")).status).toBe(200);
  expect((await send("1.1.1.1")).status).toBe(200);
  expect((await send("1.1.1.1")).status).toBe(429);
  expect((await send("2.2.2.2")).status).toBe(200);
});
